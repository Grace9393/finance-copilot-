import cors from 'cors';
import express from 'express';
import { analyseRouter } from './routes/analyse.js';
import { chatRouter } from './routes/chat.js';
import { uploadRouter } from './routes/upload.js';
import { pptxRouter } from './routes/pptx.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '30mb' }));

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.use('/api/analyse', analyseRouter);
app.use('/api/chat', chatRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/pptx', pptxRouter);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  response.status(500).json({ error: message });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
