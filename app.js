// ============================================
// COMPLETE AUDIO FEEDBACK SYSTEM
// ============================================

// ============================================
// 1. SERVER SETUP (app.js)
// ============================================

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const { OpenAI } = require('openai');

// ⭐️ NEW: Import the OpenAI configuration
const openaiConfig = require('./openaiConfig'); 

dotenv.config();
const app = express();

// Ensure temp directory exists
if (!fs.existsSync(path.join(__dirname, 'temp'))) {
  fs.mkdirSync(path.join(__dirname, 'temp'));
}

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/feedback-system', {
  autoIndex: false // Disables auto-indexing on startup
})
  .then(() => console.log('✅ MongoDB connected (AutoIndex disabled)'))
  .catch(err => console.log('❌ MongoDB error:', err));


// ⭐️ UPDATED: OpenAI Setup using config file
const openai = new OpenAI({
  apiKey: openaiConfig.apiKey,
  timeout: openaiConfig.timeout,
  maxRetries: openaiConfig.maxRetries,
});

// Email Setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ============================================
// 2. DATABASE SCHEMAS
// ============================================

const questionnaireSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  description: String,
  // ⭐️ UPDATED: Added 'type' to the schema
  questions: [{
    order: Number,
    text: String,
  }],
  createdBy: String,
  createdAt: { type: Date, default: Date.now },
  link: String,
  isActive: { type: Boolean, default: true }
});

const responseSchema = new mongoose.Schema({
  questionnaireId: mongoose.Schema.Types.ObjectId,
  respondentEmail: String,
  respondentName: String,
  responses: [{
    questionId: Number,
    questionText: String,
    transcription: String,
    normalized: String,
    timestamp: Date
  }],
  submittedAt: { type: Date, default: Date.now },
  status: { type: String, default: 'completed' }
});

const Questionnaire = mongoose.model('Questionnaire', questionnaireSchema);
const Response = mongoose.model('Response', responseSchema);

// ============================================
// 3. ROUTES
// ============================================

// LANDING PAGE
app.get('/', (req, res) => {
  res.render('index');
});

// ADMIN PAGE
app.get('/admin', (req, res) => {
  const { adminUsername } = req.query;
  if (adminUsername === 'adminjohan') {
    res.render('admin');
  } else {
    res.redirect('/');
  }
});

// API: Create Questionnaire
app.post('/api/create-questionnaire', async (req, res) => {
  try {
    const { title, description, questions } = req.body;
    
    if (!title || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid input data' });
    }

    const link = `survey-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const formattedQuestions = questions
      .filter(q => typeof q === 'string' && q.trim())
      .map((q, i) => ({
        order: i + 1,
        text: q.trim(),
      }));

    if (formattedQuestions.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one valid question required' });
    }
    
    const questionnaire = new Questionnaire({
      title: title.trim(),
      description: description ? description.trim() : '',
      questions: formattedQuestions,
      createdBy: 'admin',
      link: link
    });
    
    await questionnaire.save();
    const surveyUrl = `${process.env.APP_URL || 'http://localhost:3000'}/survey/${link}`;
    res.json({ success: true, link: surveyUrl, id: questionnaire._id });
  } catch (error){
    console.error('Error creating questionnaire:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Get all questionnaires
app.get('/api/questionnaires', async (req, res) => {
  try {
    const questionnaires = await Questionnaire.find({ createdBy: 'admin' });
    res.json({ success: true, questionnaires });
  } catch (error) {
    console.error('Error fetching questionnaires:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Get questionnaire by link
app.get('/api/survey/:link', async (req, res) => {
  try {
    const questionnaire = await Questionnaire.findOne({ link: req.params.link });
    if (!questionnaire || !questionnaire.isActive) {
      return res.status(404).json({ success: false, error: 'Survey not found' });
    }
    res.json({ success: true, questionnaire });
  } catch (error) {
    console.error('Error fetching survey:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// SURVEY PAGE
app.get('/survey/:link', async (req, res) => {
  try {
    const questionnaire = await Questionnaire.findOne({ link: req.params.link });
    if (!questionnaire || !questionnaire.isActive) {
      return res.status(404).render('not-found');
    }
    res.render('survey', { questionnaire: JSON.stringify(questionnaire) });
  } catch (error) {
    res.status(500).render('error', { error: error.message });
  }
});

// API: Text-to-Speech
app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'No text provided' });
    }

    const mp3 = await openai.audio.speech.create({
      model: 'tts-1', // Config does not specify TTS model, so keeping 'tts-1'
      voice: 'alloy', // Config does not specify TTS voice, so keeping 'alloy'
      input: text
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    res.set('Content-Type', 'audio/mpeg');
    res.send(buffer);

  } catch (error) {
    console.error('Error generating TTS audio:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Submit Response with Audio
app.post('/api/submit-response', async (req, res) => {
  try {
    const { questionnaireId, respondentName, respondentEmail, responses } = req.body;
    const processedResponses = [];

    for (const response of responses) {
      const audioBuffer = Buffer.from(response.audio, 'base64');
      const audioPath = path.join(__dirname, 'temp', `audio-${Date.now()}-${Math.random()}.wav`);
      
      fs.writeFileSync(audioPath, audioBuffer);

      try {
        // ⭐️ UPDATED: Transcribe with Whisper using config
        const transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(audioPath),
          model: openaiConfig.whisper.model,
          language: openaiConfig.whisper.language,
          response_format: openaiConfig.whisper.responseFormat,
          temperature: openaiConfig.whisper.temperature,
        });

        // ⭐️ UPDATED: Normalize text with GPT using config
        const normalizeResponse = await openai.chat.completions.create({
          model: openaiConfig.gpt.model,
          messages: [
            {
              role: 'system', // Use system prompt from config
              content: openaiConfig.prompts.cleanTranscription
            },
            {
              role: 'user',
              content: transcription.text // The raw text from Whisper
            }
          ],
          max_tokens: openaiConfig.gpt.maxTokens,
          temperature: openaiConfig.gpt.temperature,
        });

        processedResponses.push({
          questionId: response.questionId,
          questionText: response.questionText,
          transcription: transcription.text, // The original, uncleaned transcription
          normalized: normalizeResponse.choices[0].message.content, // The cleaned text
          timestamp: new Date()
        });
      } catch (aiError) {
        console.error('Error processing audio:', aiError);
        processedResponses.push({
          questionId: response.questionId,
          questionText: response.questionText,
          transcription: 'Error processing audio',
          normalized: 'Error processing audio',
          timestamp: new Date()
        });
      }

      // Clean up temp file
      try {
        fs.unlinkSync(audioPath);
      } catch (e) {}
    }

    const feedbackResponse = new Response({
      questionnaireId,
      respondentName: respondentName || respondentEmail, // Use email as name
      respondentEmail,
      responses: processedResponses
    });

    await feedbackResponse.save();
    res.json({ success: true, message: 'Response submitted successfully' });
  } catch (error) {
    console.error('Error submitting response:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Get Results
app.get('/api/results/:questionnaireId', async (req, res) => {
  try {
    const responses = await Response.find({ questionnaireId: req.params.questionnaireId });
    res.json({ success: true, responses });
  } catch (error) {
    console.error('Error fetching results:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API: Send Survey Link via Email (Bulk)
app.post('/api/send-survey-link', async (req, res) => {
  try {
    const { surveyLink, recipientEmails } = req.body;

    if (!Array.isArray(recipientEmails) || recipientEmails.length === 0) {
      return res.status(400).json({ success: false, error: 'No recipient emails provided.' });
    }

    if (recipientEmails.length > 10) {
      return res.status(400).json({ success: false, error: 'Cannot send to more than 10 emails at a time.' });
    }

    const emailPromises = recipientEmails.map(email => {
      const surveyLinkWithEmail = `${surveyLink}?email=${encodeURIComponent(email)}`;

      return transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: '🎤 Please Complete Our Audio Feedback Survey',
        html: `
          <div style="font-family: 'Segoe UI', Arial; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #4c1d95 0%, #6d28d9 100%); padding: 30px; border-radius: 12px 12px 0 0; color: white; text-align: center;">
              <h2 style="margin: 0;">Your Feedback Matters!</h2>
              <p style="margin: 10px 0 0 0; opacity: 0.9;">We would love to hear your thoughts</p>
            </div>
            <div style="background: white; padding: 30px; text-align: center;">
              <p style="color: #4b5563; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
                Please take a few minutes to complete our audio feedback survey. Your voice and opinions are valuable to us.
              </p>
              <a href="${surveyLinkWithEmail}" style="background: linear-gradient(135deg, #4c1d95 0%, #6d28d9 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600;">
                Start Survey
              </a>
              <p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">
                Or copy this link: <br><code style="background: #f3f4f6; padding: 8px; border-radius: 4px; display: inline-block; margin-top: 10px; word-break: break-all;">${surveyLinkWithEmail}</code>
              </p>
            </div>
          </div>
        `
      });
    });

    await Promise.all(emailPromises);

    res.json({ success: true, message: `Survey links sent successfully to ${recipientEmails.length} recipients.` });

  } catch (error) {
    console.error('Error sending bulk emails:', error);
    res.status(500).json({ success: false, error: 'An error occurred while sending emails.' });
  }
});

// Start server
app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server running on http://localhost:${process.env.PORT || 3000}`);
});