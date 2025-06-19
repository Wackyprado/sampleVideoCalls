// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios')

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' } // allow all for dev
});


const port = process.env.PORT || 3000;
const socketToRoom = new Map()

io.on("connection", (socket) => {
  console.log("🟢 New connection:", socket.id)

  // Handle room joining
  socket.on("join", (roomId) => {
    console.log(`📥 ${socket.id} joining room: ${roomId}`)

    socket.join(roomId)
    socketToRoom.set(socket.id, roomId)

    // Get other peers in room
    const room = io.sockets.adapter.rooms.get(roomId)
    const peers = [...room].filter((id) => id !== socket.id)

    // Send the list of existing peers to the joining socket
    socket.emit("existing-peers", peers)

    // Notify existing peers that a new one joined
    socket.to(roomId).emit("peer-joined", socket.id)
  })

  // Handle incoming offer
  socket.on("offer", ({ sdp, target }) => {
    console.log(`📡 Offer from ${socket.id} to ${target}`)
    io.to(target).emit("offer", { sdp, caller: socket.id })
  })

  // Handle answer
  socket.on("answer", ({ sdp, target }) => {
    console.log(`✅ Answer from ${socket.id} to ${target}`)
    io.to(target).emit("answer", { sdp, callee: socket.id })
  })

  // Handle ICE candidate
  socket.on("ice-candidate", ({ candidate, target }) => {
    io.to(target).emit("ice-candidate", { candidate, sender: socket.id })
  })

  // Handle disconnect
  socket.on("disconnect", () => {
    const roomId = socketToRoom.get(socket.id)
    if (roomId) {
      console.log(`❌ ${socket.id} disconnected from room: ${roomId}`)
      socket.to(roomId).emit("peer-left", socket.id)
      socketToRoom.delete(socket.id)
    }
  })
})


app.get('/ice', async (req, res) => {
  try {
    const response = await axios.put(
      'https://global.xirsys.net/_turn/videoCalls',
      {},
      {
        headers: {
          'Authorization': 'Basic ' + Buffer.from('KramCode:f3ffdb08-4cd5-11f0-9421-0242ac13000').toString('base64'),
        }
      }
    )
    const iceServers = response.data.v.iceServers
    res.json(iceServers)
  } catch (err) {
    console.error('Error fetching ICE servers:', err)
    res.status(500).send('Failed to get ICE servers')
  }
})


server.listen(port, () => {
  console.log('Server listening on ' + port);
});
