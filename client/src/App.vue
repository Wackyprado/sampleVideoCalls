<script setup>
import { ref, onMounted, onUpdated, nextTick, watch, computed } from 'vue'
import io from 'socket.io-client'

const localVideo = ref(null)
const remoteVideo = ref(null)

const remoteStreams = ref([]) // store { id, stream }
const socket = io(import.meta.env.VITE_API_URL)
//const peerConnection = new RTCPeerConnection()
const peerConnections = {}
let localStream

const blankTrack = createBlankVideoTrack()
const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent)
onMounted(async () => {
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
  const pc = new RTCPeerConnection()

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('ice-candidate', {
        target: id,
        candidate: e.candidate,
      })
    }
  }

  pc.ontrack = (e) => {
    const existing = remoteStreams.value.find((s) => s.id === id)
    if (!existing) {
      remoteStreams.value.push({ id, stream: e.streams[0] })
    }
  }

  return pc
}

onUpdated(() => {
  nextTick(() => {
    remoteStreams.value.forEach((remote) => {
      const video = document.querySelector(`video[data-id="${remote.id}"]`)
      if (video && !video.srcObject) {
        console.log(`🔗 Binding stream to video [${remote.id}]`)
        video.srcObject = remote.stream
      }
    })
  })
})

// watch(remoteStreams, () => {
//   nextTick(() => {
//     remoteStreams.value.forEach(({ id, stream }) => {
//       const video = document.querySelector(`video[data-id="${id}"]`)
//       if (video && !video.srcObject) {
//         video.srcObject = stream
//       }
//     })
//   })
// })

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
  if (remote && remote.stream) {
    el.srcObject = remote.stream
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
  if (count <= 1) return 'w-full h-full'
  if (count === 2) return 'w-[48%] h-[45vh]'
  if (count <= 4) return 'w-[48%] h-[40vh]'
  if (count <= 6) return 'w-[31%] h-[30vh]'
  return 'w-[24%] h-[25vh]'
})
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

    <main class="flex-1 p-4 flex flex-wrap justify-center items-center gap-4 bg-gray-900">
      <div
        v-for="remote in remoteStreams"
        :key="remote.id"
        class="bg-black rounded-lg overflow-hidden shadow-md"
        :class="videoCardSize"
      >
        <video
          autoplay
          playsinline
          class="w-full h-full object-cover rounded"
          :ref="(el) => attachRemoteVideo(el, remote.id)"
        ></video>
      </div>
    </main>

    <!-- Local Video -->
    <div
      class="absolute bottom-4 right-4 w-100 h-50 shadow-lg rounded-lg overflow-hidden border border-white/10"
    >
      <video ref="localVideo" autoplay playsinline muted class="w-full h-full object-cover" />
    </div>
  </div>
</template>

<style scoped></style>
