import { GoogleGenAI, Type } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('wildlife: GEMINI_API_KEY is not set — endpoint will 500');
}
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const schema = {
  type: Type.OBJECT,
  properties: {
    locationName: { type: Type.STRING },
    categories: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          speciesList: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                scientificName: { type: Type.STRING },
                spottingLocations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      address: { type: Type.STRING },
                    },
                    required: ['name', 'address'],
                  },
                },
              },
              required: ['name', 'scientificName'],
            },
          },
        },
        required: ['name', 'speciesList'],
      },
    },
  },
  required: ['locationName', 'categories'],
};

const PROMPT = (location) => `
Return wildlife commonly observed in and around "${location}".

- locationName: echo back "${location}".
- categories: 3–5 groupings (e.g. "Birds", "Mammals", "Reptiles", "Insects",
  "Plants", "Fish"). Only include categories that actually have species for
  this location.
- Each category.speciesList: 3–6 notable species.
  - name: common English name.
  - scientificName: binomial in italics-ready plain text, no asterisks.
  - spottingLocations (optional but preferred): 1–2 real parks, lakes,
    reserves, or neighbourhoods in or near "${location}" where the species
    is frequently seen, each with a short address (city or area, not a
    full postal address). Omit the field entirely if you're unsure.

Be concise. No commentary outside the JSON.
`.trim();

export default async function wildlife(req, res) {
  if (!ai) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

  const { location } = req.body ?? {};
  if (!location || typeof location !== 'string') {
    return res.status(400).json({ error: 'location (string) is required' });
  }

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: PROMPT(location),
      config: { responseMimeType: 'application/json', responseSchema: schema },
    });
    res.type('application/json').send(response.text ?? '');
  } catch (err) {
    console.error('wildlife error', err);
    res.status(502).json({ error: 'upstream model error' });
  }
}
