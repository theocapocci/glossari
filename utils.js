// utils.js

/**
 * Converts Markdown bold (**text**) to HTML strong (<strong>text</strong>).
 * @param {string} text - The text possibly containing Markdown bold.
 * @returns {string} The text with HTML strong tags.
 */
export function convertMarkdownBoldToHtml(text) {
    // Regex to find **text** or __text__ that isn't empty, and capture the text inside
    // It's important to use non-greedy matching (.*?) to prevent it from matching across multiple bold sections.
    // Also, handle potential leading/trailing whitespace around the asterisks.
    let convertedText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    convertedText = convertedText.replace(/__(.*?)__/g, '<strong>$1</strong>'); // Also for underscores, if Gemini uses them

    return convertedText;
}