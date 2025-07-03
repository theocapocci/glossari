// utils.js

/**
 * Converts Markdown bold (**text**) to HTML strong (<strong>text</strong>).
 * @param {string} text - The text possibly containing Markdown bold.
 * @returns {string} The text with HTML strong tags.
 */
export function convertMarkdownBoldToHtml(text) {
    // This regex handles both **bold** and __bold__ syntax
    return text.replace(/\*\*(.*?)\*\*|__(.*?)__/g, '<strong>$1$2</strong>');
}

/**
 * A generic function for calling the Gemini API.
 * @param {string} prompt
 * @param {string} apiKey
 * @returns {Promise<string>} The text content from the Gemini response.
 */
export async function callGeminiAPI(prompt, apiKey) {
    const model = "gemini-2.0-flash";
    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
        const response = await fetch(geminiApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        if (!response.ok) {
            // Try to parse error from Google's response format
            const errorData = await response.json().catch(() => null);
            const errorMessage = errorData?.error?.message || `HTTP error! status: ${response.status}`;
            throw new Error(`Gemini API Error: ${errorMessage}`);
        }

        const data = await response.json();

        if (!data.candidates || data.candidates.length === 0) {
            // Handle cases where the API returns a 200 OK but no candidates (e.g., safety blocks)
            const blockReason = data.promptFeedback?.blockReason;
            if (blockReason) {
                throw new Error(`Request to Gemini was blocked. Reason: ${blockReason}`);
            }
            throw new Error("Gemini API returned no candidates in the response.");
        }

        return data.candidates[0].content.parts[0].text.trim();

    } catch (error) {
        // Catch network errors or other unexpected issues
        console.error("Failed to fetch from Gemini API:", error);
        throw error; // Re-throw the error to be handled by the calling function
    }
}
