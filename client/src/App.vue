<script setup>
import { ref, onMounted } from 'vue'
import io from 'socket.io-client'

const localVideo = ref(null)
const remoteVideo = ref(null)
const socket = io(import.meta.env.VITE_API_URL)
const peerConnection = new RTCPeerConnection()

let localStream

onMounted(async () => {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
  localVideo.value.srcObject = localStream

  localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream))

  socket.emit('join', 'room123')

  peerConnection.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('ice-candidate', {
        target: remoteSocketId,
        candidate: e.candidate,
      })
    }
  }

  peerConnection.ontrack = (e) => {
    remoteVideo.value.srcObject = e.streams[0]
  }
})

let remoteSocketId = null

socket.on('peer-joined', async (id) => {
  remoteSocketId = id
  const offer = await peerConnection.createOffer()
  await peerConnection.setLocalDescription(offer)
  socket.emit('offer', { sdp: offer, target: id })
})

socket.on('offer', async ({ sdp, caller }) => {
  remoteSocketId = caller
  await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp))
  const answer = await peerConnection.createAnswer()
  await peerConnection.setLocalDescription(answer)
  socket.emit('answer', { sdp: answer, target: caller })
})

socket.on('answer', async ({ sdp }) => {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp))
})

socket.on('ice-candidate', async ({ candidate }) => {
  await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
})
</script>

<template>
  <div>
    <video ref="localVideo" autoplay playsinline muted></video>
    <video ref="remoteVideo" autoplay playsinline></video>
  </div>
</template>

<style scoped>
video {
  width: 300px;
  margin: 10px;
}
</style>
