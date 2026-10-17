//@ts-check
'use strict';

const http = require('node:http');

function createPipeServer({ pipePath, requestHandler = () => {}, onError = () => {} } = {}) {
  if (typeof pipePath !== 'string' || !pipePath.includes('\\.\\pipe\\')) {
    throw new Error('Invalid pipe path');
  }

  const server = http.createServer((req, res) => {
    try {
      requestHandler(req, res);
    } catch (error) {
      onError(error);
      if (!res.headersSent) {
        res.statusCode = 500;
      }
      res.end('Internal Server Error');
    }
  });

  server.on('error', (error) => {
    onError(error);
  });

  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', (error) => reject(error));
        server.listen(pipePath, () => {
          resolve(server);
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

module.exports = {
  createPipeServer
};
