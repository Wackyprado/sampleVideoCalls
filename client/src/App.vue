<script setup>
import { ref, onMounted, onUpdated, nextTick } from 'vue'
import io from 'socket.io-client'

const localVideo = ref(null)
const remoteVideo = ref(null)

const remoteStreams = ref([]) // store { id, stream }
const socket = io(import.meta.env.VITE_API_URL)
//const peerConnection = new RTCPeerConnection()
const peerConnections = {}
let localStream

// onMounted(async () => {
//   localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
//   localVideo.value.srcObject = localStream

//   localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream))

//   socket.emit('join', 'room123')

//   peerConnection.onicecandidate = (e) => {
//     if (e.candidate) {
//       socket.emit('ice-candidate', {
//         target: remoteSocketId,
//         candidate: e.candidate,
//       })
//     }
//   }

//   peerConnection.ontrack = (e) => {
//     remoteVideo.value.srcObject = e.streams[0]
//   }
// })

onMounted(async () => {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
  localVideo.value.srcObject = localStream
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
  const pc = createPeerConnection(id)
  peerConnections[id] = pc

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream))

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  socket.emit('offer', { sdp: offer, target: id })
})

socket.on('offer', async ({ sdp, caller }) => {
  const pc = createPeerConnection(caller)
  peerConnections[caller] = pc

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream))

  await pc.setRemoteDescription(new RTCSessionDescription(sdp))
  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)
  socket.emit('answer', { sdp: answer, target: caller })
})

socket.on('answer', async ({ sdp, callee }) => {
  await peerConnections[callee].setRemoteDescription(new RTCSessionDescription(sdp))
})

socket.on('ice-candidate', async ({ candidate, sender }) => {
  if (peerConnections[sender]) {
    await peerConnections[sender].addIceCandidate(new RTCIceCandidate(candidate))
  }
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
    console.log('Track received from:', id, e.streams[0])
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
</script>

<template>
  <div>
    <h3>Local</h3>
    <video ref="localVideo" autoplay playsinline muted></video>

    <h3>Remote Peers</h3>
    <div v-for="remote in remoteStreams" :key="remote.id">
      <video :data-id="remote.id" autoplay playsinline></video>
    </div>
  </div>
</template>

<style scoped>
video {
  width: 300px;
  height: auto;
  background: black;
  margin: 10px;
}
</style>
