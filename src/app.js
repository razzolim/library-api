import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes.js';
import booksRoutes from './routes/books.routes.js';
import changelogRoutes from './routes/changelog.routes.js';
import usersRoutes from './routes/users.routes.js';

const app = express();

const corsOrigin = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim());

app.use(
  cors({
    origin: corsOrigin,
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(express.json());

app.use('/api', authRoutes);
app.use('/api', booksRoutes);
app.use('/api', changelogRoutes);
app.use('/api', usersRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: `No route for ${req.method} ${req.path}` });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ success: false, error: 'Internal Server Error' });
});

export default app;
