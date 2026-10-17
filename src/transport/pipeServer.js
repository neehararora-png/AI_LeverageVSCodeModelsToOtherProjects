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

  server.headersTimeout = 30000;
  server.requestTimeout = 30000;
  server.keepAliveTimeout = 15000;

  server.on('error', (error) => {
    onError(error);
  });

  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        server.once('error', onError);
        server.listen({ path: pipePath }, () => {
          server.removeListener('error', onError);
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
