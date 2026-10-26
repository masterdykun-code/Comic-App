import 'dotenv/config';
import app from './app';
import { getJwtSecret } from './config/auth';

getJwtSecret();

const port = Number(process.env.PORT ?? 4000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const server = app.listen(port, () => {
  console.log(`WebNovel API is running on http://localhost:${port}`);
});

server.on('error', (error) => {
  console.error('Failed to start WebNovel API:', error.message);
  process.exit(1);
});
