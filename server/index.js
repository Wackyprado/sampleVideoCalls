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

io.on('connection', socket => {
  console.log('a user connected:', socket.id);

  socket.on('join', room => {
    socket.join(room);
    socket.to(room).emit('peer-joined', socket.id);
  });

  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      sdp: data.sdp,
      caller: socket.id
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      sdp: data.sdp,
      callee: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });
});



server.listen(port, () => {
  console.log('Server listening on ' + port);
});
