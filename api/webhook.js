// api/webhook.js
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

// Vercel handles env vars automatically
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const DISCORD_WEBHOOKS = {
    maincro: process.env.WEBHOOK_MAINCRO,
    altcro: process.env.WEBHOOK_ALTCRO,
    ducro: process.env.WEBHOOK_DUCRO,
    tricro: process.env.WEBHOOK_TRICRO
};

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const { account } = req.query;

    if (!DISCORD_WEBHOOKS[account]) {
        return res.status(400).send("Unknown account or missing webhook config.");
    }

    try {
        // Vercel parses JSON bodies automatically, but for binary/multipart 
        // sometimes we need the raw buffer. However, for simple forwarding:
        
        // 1. Forward to Discord
        // We pass the body exactly as received.
        const discordResponse = await axios.post(
            `${DISCORD_WEBHOOKS[account]}?wait=true`,
            req.body,
            {
                headers: {
                    'Content-Type': req.headers['content-type']
                }
            }
        );

        // 2. Extract Data for Dashboard
        const msg = discordResponse.data;
        let screenshotUrl = null;
        if (msg.attachments && msg.attachments.length > 0) {
            screenshotUrl = msg.attachments[0].url;
        }

        let status = "Update";
        let location = "Unknown";
        if (msg.embeds && msg.embeds.length > 0) {
            const embed = msg.embeds[0];
            status = embed.description || embed.title || "Update";
            if (embed.fields) {
                const locField = embed.fields.find(f => f.name.includes("Location") || f.name.includes("Field"));
                if (locField) location = locField.value;
            }
        }

        // 3. Save to Supabase
        await supabase.from('natro_logs').insert([
            {
                account_name: account,
                status: status,
                location: location,
                screenshot_url: screenshotUrl
            }
        ]);

        // 4. Cleanup old logs (Keep last 20 mins)
        const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
        await supabase.from('natro_logs').delete().lt('created_at', twentyMinsAgo);

        res.status(200).send("Forwarded & Logged");

    } catch (error) {
        console.error("Error forwarding:", error.message);
        res.status(500).send("Internal Server Error");
    }
}
