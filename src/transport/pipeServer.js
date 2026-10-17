//@ts-check
'use strict';

const http = require('node:http');

function createPipeServer({ pipePath, requestHandler = () => {}, onError = () => {} } = {}) {
  if (typeof pipePath !== 'string' || !pipePath.startsWith('\\\\.\\pipe\\')) {
    throw new Error('Invalid pipe path');
  }

  const server = http.createServer((req, res) => {
    Promise.resolve().then(() => requestHandler(req, res)).catch((error) => {
      try {
        onError(error);
      } catch {
        // Error reporting must not prevent the response from completing.
      }
      if (res.destroyed) {
        return;
      }
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Internal Server Error');
    });
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
