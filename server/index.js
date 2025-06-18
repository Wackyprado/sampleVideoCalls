// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');


const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' } // allow all for dev
});


const port = process.env.PORT || 3000;

io.on('connection', (socket) => {
  socket.on('join', (roomId) => {
    socket.join(roomId);

    // Notify existing peers about the new one
    socket.to(roomId).emit('peer-joined', socket.id);

    // Send existing peer list to new peer
    const peers = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    const others = peers.filter(id => id !== socket.id);
    socket.emit('existing-peers', others);
  });

  socket.on('offer', ({ sdp, target }) => {
    io.to(target).emit('offer', { sdp, caller: socket.id });
  });

  socket.on('answer', ({ sdp, target }) => {
    io.to(target).emit('answer', { sdp, callee: socket.id });
  });

  socket.on('ice-candidate', ({ candidate, target }) => {
    io.to(target).emit('ice-candidate', { candidate, sender: socket.id });
  });
});



server.listen(port, () => {
  console.log('Server listening on ' + port);
});
