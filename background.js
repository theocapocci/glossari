// Log a message to the console to confirm the background script is loaded
console.log("Glossari background service worker loaded!");

// Listener for creating a simple n+1 Anki flashcard
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    // Check if the message is for our specific action
    if (request.action === "createAnkiFlashcard") {
        const { selectedWord, fullSentence } = request;

        try {
            // 1. Get Gemini API Key from storage
            const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
            if (!geminiApiKey) {
                throw new Error("Gemini API Key is not set in the extension popup.");
            }

            // 2. Get a simple, contextual definition from Gemini
            const model = "gemini-2.0-flash";
            const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
            const aiPrompt = `What is the definition of the word "${selectedWord}" as it is used in the sentence: "${fullSentence}"? Provide only the definition.`;

            const aiResponse = await fetch(geminiApiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: aiPrompt }] }] })
            });

            const aiData = await aiResponse.json();
            if (!aiResponse.ok || !aiData.candidates) {
                throw new Error(aiData.error?.message || "AI API request failed.");
            }
            const definition = aiData.candidates[0].content.parts[0].text.trim();

            // 3. Prepare Anki Flashcard Content
            const ankiFront = fullSentence; // Just the sentence
            const ankiBack = `<strong>${selectedWord}</strong><br><hr>${definition}`; // Word + definition

            // 4. Send to AnkiConnect
            const ankiConnectUrl = "http://127.0.0.1:8765";
            const ankiPayload = {
                action: "addNote",
                version: 6,
                params: {
                    note: {
                        deckName: "Glossari Sentence Mining", // Change to your desired Anki deck
                        modelName: "Obsidian-basic", // Ensure this note type exists
                        fields: {
                            "Front": ankiFront,
                            "Back": ankiBack
                        },
                        tags: ["glossari_n+1"]
                    }
                }
            };
            const ankiResult = await (await fetch(ankiConnectUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(ankiPayload)
            })).json();

            if (ankiResult.error) {
                throw new Error(`AnkiConnect Error: ${ankiResult.error}`);
            }
            console.log("Anki card added successfully:", ankiResult.result);

        } catch (error) {
            console.error("Glossari Flashcard Creation Error:", error.message);
            // You can optionally send a message back to the popup to display the error
        }
        
        // Return true to indicate you will send a response asynchronously (good practice)
        return true;
    }
});