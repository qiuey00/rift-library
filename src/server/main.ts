import { PORT, startServer } from './server';

const server = startServer();

server.on('listening', () => {
  console.log(`Rift Library is running at http://localhost:${PORT}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Rift Library may already be running: open http://localhost:${PORT}, or stop the other copy first.`,
    );
    process.exit(1);
  }
  throw err;
});
