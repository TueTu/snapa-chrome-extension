require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Initialize OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'dummy_key_for_init',
});

// Initialize Gemini API
const genAI = process.env.GEMINI_API_KEY 
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    let textStr = "";

    if (genAI) {
      // Use Gemini if configured
      console.log("Using Gemini API");
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(message);
      const response = await result.response;
      textStr = response.text();
    } else {
      // Fallback to OpenAI
      console.log("Using OpenAI API");
      const completion = await openai.chat.completions.create({
        messages: [{ role: "user", content: message }],
        model: "gpt-4o",
      });
      textStr = completion.choices[0].message.content;
    }

    res.json({ reply: textStr });
  } catch (error) {
    console.error('Error generating response:', error);
    res.status(500).json({ error: 'Internal Server Error: ' + error.message });
  }
});

app.get('/', (req, res) => {
  res.send('AI Chat Server is running');
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
