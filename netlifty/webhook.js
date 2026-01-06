// netlify/functions/webhook.js
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const FormData = require('form-data');

// --- CONFIGURATION ---
// You will set these in Netlify Environment Variables later
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Map your accounts to their REAL Discord Webhooks
const DISCORD_WEBHOOKS = {
    maincro: process.env.WEBHOOK_MAINCRO,
    altcro: process.env.WEBHOOK_ALTCRO,
    ducro: process.env.WEBHOOK_DUCRO,
    tricro: process.env.WEBHOOK_TRICRO
};

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    // 1. Get the account name from the URL (e.g., /webhook?account=maincro)
    const params = new URLSearchParams(event.queryStringParameters);
    const account = event.queryStringParameters.account || "unknown";
    
    if (!DISCORD_WEBHOOKS[account]) {
        return { statusCode: 400, body: "Unknown account or missing webhook config." };
    }

    try {
        // 2. Parse the incoming data from Natro
        // Natro sends multipart/form-data. We need to parse this.
        // Netlify gives us the body as base64 if it's binary.
        const bodyBuffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
        
        // We need to forward this EXACT data to Discord, but add ?wait=true
        // Note: Parsing multipart in Lambda is hard. 
        // TRICK: We blindly forward the buffer to Discord with the same headers.
        
        const discordResponse = await axios.post(
            `${DISCORD_WEBHOOKS[account]}?wait=true`, // wait=true forces Discord to return the message object
            bodyBuffer,
            {
                headers: {
                    'Content-Type': event.headers['content-type'] || event.headers['Content-Type']
                }
            }
        );

        // 3. Extract Info from Discord's Response
        // Discord returns the message object. We get the attachment URL from there!
        const msg = discordResponse.data;
        
        // Find screenshot URL if it exists
        let screenshotUrl = null;
        if (msg.attachments && msg.attachments.length > 0) {
            screenshotUrl = msg.attachments[0].url;
        }

        // Extract Status/Location from Embeds
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

        // 4. Save metadata to Supabase
        await supabase.from('natro_logs').insert([
            {
                account_name: account,
                status: status,
                location: location,
                screenshot_url: screenshotUrl
            }
        ]);

        // 5. Cleanup: Delete logs older than 20 minutes to save DB space
        // (Optional: You can remove this if you want to keep history)
        const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
        await supabase.from('natro_logs').delete().lt('created_at', twentyMinsAgo);

        return { statusCode: 200, body: "Forwarded & Logged" };

    } catch (error) {
        console.error("Error:", error.message);
        return { statusCode: 500, body: "Internal Error" };
    }
};
