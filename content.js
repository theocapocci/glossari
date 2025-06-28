// Log a message to the console to confirm the content script is loaded
console.log("Glossari content script loaded!");

// Listener for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // IMPORTANT: Always return true from the listener if sendResponse will be called,
    // even if it's called synchronously. This tells Chrome to keep the message channel open.
    if (request.action === "getWordAndContext") {
        const selection = window.getSelection();
        const selectedText = selection.toString(); // Get the selected text from the browser's selection
        let contextSentence = "";

        if (selectedText.length > 0) {
            // Attempt to find the full sentence containing the selection
            const range = selection.getRangeAt(0); // Get the first range of the selection
            const commonAncestor = range.commonAncestorContainer; // The deepest common ancestor node

            // Try to find the parent text node or element containing the text
            let textContainer = commonAncestor;
            // Traverse up until we find a block-level element or a major text container
            while (textContainer && textContainer.nodeType !== Node.ELEMENT_NODE && textContainer.parentNode) {
                textContainer = textContainer.parentNode;
            }
            if (!textContainer || textContainer.nodeType !== Node.ELEMENT_NODE) {
                textContainer = document.body; // Fallback to body if no clear container found
            }
            
            const fullText = textContainer.textContent || ''; // Get all text content from the container

            // Basic sentence segmentation using regex (can be improved with NLP for accuracy)
            // This regex tries to find sentences ending with . ! ? followed by a space or end of string
            const sentences = fullText.match(/[^.!?]+[.!?]|\S+/g) || [];
            
            // Find the sentence that contains the selected text
            for (const sentence of sentences) {
                if (sentence.includes(selectedText)) {
                    contextSentence = sentence.trim();
                    break;
                }
            }

            // Fallback if no specific sentence found, take a snippet
            if (!contextSentence && fullText.includes(selectedText)) {
                const startIndex = fullText.indexOf(selectedText);
                const endIndex = startIndex + selectedText.length;
                // Take a larger chunk if exact sentence not found
                contextSentence = fullText.substring(Math.max(0, startIndex - 50), Math.min(fullText.length, endIndex + 50)).trim();
                if (contextSentence.length > 0 && (startIndex - 50) > 0) {
                    contextSentence = "..." + contextSentence; // Add ellipsis if not start of text
                }
                if (contextSentence.length > 0 && (endIndex + 50) < fullText.length) {
                    contextSentence = contextSentence + "..."; // Add ellipsis if not end of text
                }
            }
        }

        // Always send a response, even if selectedText or contextSentence are empty
        sendResponse({ 
            selectedText: selectedText, 
            contextSentence: contextSentence 
        });
        return true; // Important: Indicate that sendResponse will be called.
    } else if (request.action === "displayInfo") {
        // Existing logic to display messages on the page
        const infoMessage = request.data;
        
        let glossariDisplay = document.getElementById('glossari-display');
        if (!glossariDisplay) {
            glSossariDisplay = document.createElement('div');
            glossariDisplay.id = 'glossari-display';
            Object.assign(glossariDisplay.style, {
                position: 'fixed',
                bottom: '20px',
                right: '20px',
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid #ccc',
                padding: '10px',
                borderRadius: '8px',
                boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)',
                zIndex: '99999',
                maxWidth: '300px',
                fontFamily: 'Inter, sans-serif',
                fontSize: '14px',
                color: '#333'
            });
            document.body.appendChild(glossariDisplay);
        }
        
        glossariDisplay.textContent = infoMessage;

        setTimeout(() => {
            if (glossariDisplay) {
                glossariDisplay.remove();
            }
        }, 5000);
    }
});
