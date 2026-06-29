'use strict';
import http from 'http';
import SocketIO from 'socket.io';
import config from './config';

let io;
let userSocketMap = {};

// Define the Socket.io configuration method
export default {
  init: (app) => {
    let server = http.createServer(app);

    io = SocketIO(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    io.on('connect', (socket) => {
      let handshakeData = socket.request;
      if (handshakeData && handshakeData._query && handshakeData._query.params) {
        if (typeof handshakeData._query.params === 'string') {
          let params = JSON.parse(handshakeData._query.params);
          if (params.pair) {
            subscribeRoom({ io: io, socket: socket, data: params });
          }
        }
      }

      socket.on('userConnected', (data) => {
        addUserSocketMap(data, socket);
      });

      socket.on('subscribeRoom', (data) => {
        subscribeRoom({ io: io, socket: socket, data: data });
      });

      socket.on('unsubscribeRoom', (data) => {
        unsubscribeRoom({ io: io, socket: socket, data: data });
      });

      socket.on('disconnect', () => {
        console.log(`Disconnected ${socket.id}`);
        deleteUserSocketMap(socket);
      });

      // DRAFT COLLABORATION
      socket.on("joinDraft", (mailId) => {
        socket.join(`draft_${mailId}`);
      });

      socket.on("draft:change", ({ roomId, content }) => {
        socket.to(`draft_${roomId}`).emit("draft:update", {
          content,
          senderId: socket.id
        });
      });

      socket.on("leaveDraft", (mailId) => {
        if (!mailId) return;
        socket.leave(`draft_${mailId}`);
      });
    });

    return server;
  },
  getIo: () => io,
  getUserSocketMap: () => userSocketMap,
};

async function addUserSocketMap(data, socket) {
  try {
    if (data.userId) {
      let userId = data.userId;
      let socketId = socket.id;
      socket.userId = userId;
      if (userSocketMap[userId] && userSocketMap[userId].indexOf(socketId) === -1) {
        userSocketMap[userId].push(socketId);
      }
      if (!userSocketMap[userId]) {
        userSocketMap[userId] = [socketId];
      }
    }
  } catch (err) {
    console.log('error occurred ' + err);
  }
}

function deleteUserSocketMap(socket) {
  try {
    let socketId = socket.id;
    let userId = socket.userId;
    if (userId) {
      let sids = userSocketMap[userId];
      if (sids && sids.length > 0) {
        let index = sids.indexOf(socketId);
        if (index > -1) {
          sids.splice(index, 1);
        }
      }
      if (userSocketMap[userId] && userSocketMap[userId].length === 0) {
        delete userSocketMap[userId];
      }
    }
  } catch (err) {
    console.log('error occurred ' + err);
  }
}

function subscribeRoom({ io, socket, data }) {
  let newPair = data.pair;
  if (!newPair) {
    socket.emit('requiredPair', { errorCode: "9001", errorMessage: 'Pair is required' });
    return;
  }
  if (data.userId) {
    addUserSocketMap(data, socket);
  }
  socket.rooms.forEach((room) => {
    if (room !== socket.id && room !== newPair) {
      socket.leave(room);
    }
  });
  if (!socket.rooms.has(newPair)) {
    socket.join(newPair);
  }
}

function unsubscribeRoom({ socket, data }) {
  let newPair = data.pair;
  if (socket.rooms && socket.rooms[newPair]) {
    socket.leave(newPair);
  }
  socket.emit("unsubscribeRoom", {
    respMessage: 'Pair disconnected (' + newPair + ')'
  });
}
