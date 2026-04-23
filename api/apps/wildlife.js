import { GoogleGenAI, Type } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('wildlife: GEMINI_API_KEY is not set — endpoint will 500');
}
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

const schema = {
  type: Type.OBJECT,
  properties: {
    habitat: { type: Type.STRING },
    species: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          commonName: { type: Type.STRING },
          scientificName: { type: Type.STRING },
          description: { type: Type.STRING },
          kingdom: { type: Type.STRING },
        },
        required: ['commonName', 'scientificName', 'description', 'kingdom'],
      },
    },
  },
  required: ['habitat', 'species'],
};

export default async function wildlife(req, res) {
  if (!ai) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

  const { location } = req.body ?? {};
  if (!location || typeof location !== 'string') {
    return res.status(400).json({ error: 'location (string) is required' });
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `List notable native wildlife species found in and around ${location}. Describe the habitat briefly and return 8-12 species across different kingdoms where possible.`,
      config: { responseMimeType: 'application/json', responseSchema: schema },
    });
    res.type('application/json').send(response.text ?? '');
  } catch (err) {
    console.error('wildlife error', err);
    res.status(502).json({ error: 'upstream model error' });
  }
}
