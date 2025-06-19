<script setup>
import { ref, onMounted, onUpdated, nextTick, watch, computed } from 'vue'
import io from 'socket.io-client'
import { createSwapy } from 'swapy'
import axios from 'axios'

const swapy = ref(null)
const container = ref()
const localVideo = ref(null)
const remoteVideo = ref(null)

const remoteStreams = ref([]) // store { id, stream }
const socket = io(import.meta.env.VITE_API_URL)
//const peerConnection = new RTCPeerConnection()
const peerConnections = {}
let localStream
let iceServers = []
const blankTrack = createBlankVideoTrack()
const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent)

const localVideoContainer = ref(null)
let isDragging = false
let offset = { x: 0, y: 0 }

async function fetchIceServers() {
  try {
    const res = await axios.get(import.meta.env.VITE_API_URL + '/ice')
    iceServers.value = res.data
    console.log('✅ ICE servers loaded:', iceServers.value)
  } catch (e) {
    console.error('❌ Failed to fetch ICE servers', e)
  }
}

onMounted(async () => {
  await fetchIceServers()
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    if (localVideo.value) {
      localVideo.value.srcObject = localStream
    }
    console.log('Local stream loaded ✅')
  } catch (err) {
    console.error('Error loading camera:', err)
  }

  socket.emit('join', 'room123')

  nextTick(() => {
    if (localVideoContainer.value) {
      const width = localVideoContainer.value.offsetWidth
      const height = localVideoContainer.value.offsetHeight
      console.log('Video dimensions:', width, height)
    }
  })

  if (container.value) {
    swapy.value = createSwapy(container.value)

    // Your event listeners
    swapy.value.onSwap((event) => {
      console.log('swap', event)
    })
  }

  // const container = document.getElementById('video-grid')
  // if (container) {
  //   new swapy(container, {
  //     animation: true,
  //     draggableClass: 'draggable-tile',
  //   })
  // }
})

let remoteSocketId = null

// socket.emit('join', 'room123');

socket.on('existing-peers', (peers) => {
  peers.forEach(async (id) => {
    const pc = createPeerConnection(id)
    peerConnections[id] = pc

    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream))

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    socket.emit('offer', { sdp: offer, target: id })
  })
})
socket.on('peer-joined', async (id) => {
  if (peerConnections[id]) return // already connected

  const pc = createPeerConnection(id)
  peerConnections[id] = pc

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream))
})
socket.on('offer', async ({ sdp, caller }) => {
  let pc = peerConnections[caller]

  if (!pc) {
    pc = createPeerConnection(caller)
    peerConnections[caller] = pc

    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream))
  }

  // 🛡️ Only apply remote offer if the state is correct
  if (pc.signalingState === 'stable') {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    socket.emit('answer', { sdp: answer, target: caller })
  } else {
    console.warn(`⚠️ Skipped setRemoteDescription. Current signalingState: ${pc.signalingState}`)
  }
})

socket.on('answer', async ({ sdp, callee }) => {
  await peerConnections[callee].setRemoteDescription(new RTCSessionDescription(sdp))
})

socket.on('ice-candidate', async ({ candidate, sender }) => {
  if (peerConnections[sender]) {
    await peerConnections[sender].addIceCandidate(new RTCIceCandidate(candidate))
  }
})

socket.on('peer-left', (id) => {
  console.log(`❌ Peer ${id} left`)
  delete peerConnections[id]
  remoteStreams.value = remoteStreams.value.filter((s) => s.id !== id)
})

function createPeerConnection(id) {
  // const pc = new RTCPeerConnection({
  //   iceServers: [
  //     { urls: 'stun:stun.l.google.com:19302' }, // ✅ Public STUN
  //     {
  //       urls: 'turn:openrelay.metered.ca:80', // ✅ Free TURN (relay)
  //       username: 'openrelayproject',
  //       credential: 'openrelayproject',
  //     },
  //   ],
  // })

  const pc = new RTCPeerConnection({
    iceServers: iceServers.value.length
      ? iceServers.value
      : [{ urls: 'stun:stun.l.google.com:19302' }], // fallback STUN
  })

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('ice-candidate', { target: id, candidate: e.candidate })
    }
  }

  pc.ontrack = (e) => {
    const stream = e.streams[0]
    const existing = remoteStreams.value.find((r) => r.id === id)
    if (!existing && stream) {
      console.log('✅ Track received:', id, stream)
      remoteStreams.value.push({ id, stream })
    }
  }

  return pc
}

// onUpdated(() => {
//   nextTick(() => {
//     remoteStreams.value.forEach((remote) => {
//       const video = document.querySelector(`video[data-id="${remote.id}"]`)
//       if (video && !video.srcObject) {
//         console.log(`🔗 Binding stream to video [${remote.id}]`)
//         video.srcObject = remote.stream
//       }
//     })
//   })
// })

watch(remoteStreams, () => {
  nextTick(() => {
    remoteStreams.value.forEach(({ id, stream }) => {
      const video = document.querySelector(`video[data-id="${id}"]`)
      if (video && !video.srcObject) {
        video.srcObject = stream
      }
    })
  })
})

const isMuted = ref(false)

function toggleMute() {
  const audioTrack = localStream?.getAudioTracks()[0]
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled
    isMuted.value = !audioTrack.enabled
  }
}

let usingFrontCamera = true

async function switchCamera() {
  // Stop current video track
  localStream?.getVideoTracks()[0]?.stop()

  usingFrontCamera = !usingFrontCamera

  const newStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: usingFrontCamera ? 'user' : 'environment' },
    audio: true,
  })

  const newVideoTrack = newStream.getVideoTracks()[0]
  const oldVideoTrack = localStream.getVideoTracks()[0]

  // Replace video track in the stream and in each connection
  localStream.removeTrack(oldVideoTrack)
  localStream.addTrack(newVideoTrack)

  if (localVideo.value) {
    localVideo.value.srcObject = newStream
  }

  // Replace the track in all peer connections
  for (const pc of Object.values(peerConnections)) {
    const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
    if (sender) {
      sender.replaceTrack(newVideoTrack)
    }
  }

  // Update local stream reference
  localStream = newStream
}

const isCameraOff = ref(false)

async function toggleCamera() {
  const videoTrack = localStream?.getVideoTracks()[0]

  if (!isCameraOff.value && videoTrack) {
    // 👉 Turn camera off
    videoTrack.stop()
    localStream.removeTrack(videoTrack)
    isCameraOff.value = true

    if (localVideo.value) {
      localVideo.value.srcObject = null
    }

    // Optionally notify peers (not required for track stop)
  } else {
    // 👉 Turn camera back on
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    })

    const newVideoTrack = newStream.getVideoTracks()[0]
    localStream.addTrack(newVideoTrack)

    // 🔄 Replace video track in all existing peer connections
    for (const pc of Object.values(peerConnections)) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
      if (sender) {
        sender.replaceTrack(newVideoTrack)
      } else {
        pc.addTrack(newVideoTrack, localStream)
      }
    }

    // ✅ Update local preview
    if (localVideo.value) {
      localVideo.value.srcObject = localStream
    }

    isCameraOff.value = false
  }
}

function leaveRoom() {
  // Close all peer connections
  Object.values(peerConnections).forEach((pc) => pc.close())
  Object.keys(peerConnections).forEach((id) => delete peerConnections[id])

  // Stop local media tracks
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop())
  }

  // Clear video element
  if (localVideo.value) {
    localVideo.value.srcObject = null
  }

  // Leave the room
  socket.emit('leave-room')

  // Clear remote streams
  remoteStreams.value = []
}

function attachRemoteVideo(el, id) {
  if (!el) return
  const remote = remoteStreams.value.find((r) => r.id === id)
  if (remote && remote.stream && el.srcObject !== remote.stream) {
    el.srcObject = remote.stream
    console.log(`📹 Attached stream for peer ${id}`)
  }
}

function createBlankVideoTrack() {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 480
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'black'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const stream = canvas.captureStream(10) // 10 FPS
  return stream.getVideoTracks()[0]
}

for (const pc of Object.values(peerConnections)) {
  const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
  if (sender) {
    sender.replaceTrack(blankTrack)
  }
}

const videoCardSize = computed(() => {
  const count = remoteStreams.value.length
  if (count <= 1) return 'w-full h-[80vh]'
  if (count === 2) return 'w-[48%] h-[45vh]'
  if (count <= 4) return 'w-[48%] h-[40vh]'
  if (count <= 6) return 'w-[31%] h-[30vh]'
  return 'w-[24%] h-[25vh]'
})

function startDrag(e) {
  isDragging = true
  const rect = localVideoContainer.value.getBoundingClientRect()
  offset.x = e.clientX - rect.left
  offset.y = e.clientY - rect.top

  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', stopDrag)
}

function onDrag(e) {
  if (!isDragging || !localVideoContainer.value) return
  const el = localVideoContainer.value
  if (!el) return
  const winWidth = window.innerWidth
  const winHeight = window.innerHeight

  const width = localVideoContainer.value.offsetWidth || 0
  const height = localVideoContainer.value.offsetHeight || 0

  const x = Math.min(Math.max(0, e.clientX - offset.x), winWidth - width)
  const y = Math.min(Math.max(0, e.clientY - offset.y), winHeight - height)

  localVideoContainer.value.style.left = `${x}px`
  localVideoContainer.value.style.top = `${y}px`
  localVideoContainer.value.style.right = 'auto'
  localVideoContainer.value.style.bottom = 'auto'
  localVideoContainer.value.style.position = 'absolute'
}

function stopDrag() {
  isDragging = false
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', stopDrag)
}

const winWidth = window.innerWidth
const winHeight = window.innerHeight

const width = 0
const height = 0

const x = 0
const y = 0
</script>

<template>
  <div class="h-screen w-screen flex flex-col bg-gray-900 text-white">
    <!-- Header -->
    <header class="flex items-center justify-between p-4 bg-gray-800 shadow">
      <h1 class="text-lg font-semibold">Video Room</h1>
      <div class="flex space-x-2">
        <button
          @click="toggleMute"
          class="bg-gray-700 hover:bg-gray-600 text-sm px-3 py-2 rounded transition"
        >
          {{ isMuted ? 'Unmute' : 'Mute' }}
        </button>
        <button
          @click="toggleCamera"
          class="bg-gray-700 hover:bg-gray-600 text-sm px-3 py-2 rounded transition"
        >
          {{ isCameraOff ? 'Turn Camera On' : 'Close Camera' }}
        </button>
        <button
          v-if="isMobile"
          @click="switchCamera"
          class="bg-gray-700 hover:bg-gray-600 text-sm px-3 py-2 rounded transition"
        >
          Switch Camera
        </button>
        <button
          @click="leaveRoom"
          class="bg-red-600 hover:bg-red-500 text-sm px-3 py-2 rounded transition"
        >
          Leave
        </button>
      </div>
    </header>

    <main
      id="video-grid"
      ref="container"
      class="flex flex-wrap justify-center items-center gap-4 w-full h-full p-4"
    >
      <div
        v-for="remote in remoteStreams"
        :key="remote.id"
        class="draggable-tile bg-black rounded-lg overflow-hidden shadow-md w-[300px] h-[200px] cursor-move"
      >
        <video
          :ref="(el) => attachRemoteVideo(el, remote.id)"
          autoplay
          playsinline
          class="w-full h-full object-cover rounded"
        />
      </div>
    </main>
    <!-- Local Video -->
    <div
      ref="localVideoContainer"
      class="absolute bottom-4 right-4 w-100 h-50 shadow-lg rounded-lg overflow-hidden border border-white/10 cursor-move z-50"
      @mousedown="startDrag"
    >
      <video ref="localVideo" autoplay playsinline muted class="w-full h-full object-cover" />
    </div>
  </div>
</template>

<style scoped>
.draggable-tile {
  transition: transform 0.2s ease;
}
</style>
