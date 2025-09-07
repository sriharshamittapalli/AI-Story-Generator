/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { html } from 'htm/preact';
import { GoogleGenAI, Type, Modality } from "@google/genai";

// --- Types ---
interface Scene {
  text: string;
  imageUrl: string;
}

// --- Main App Component ---
function App() {
  const [prompt, setPrompt] = useState('');
  const [story, setStory] = useState<Scene[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);

  const handleGenerateStory = async (e: Event) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setError("Please enter a story theme.");
      return;
    }
    setError(null);
    setIsLoading(true);
    setStory(null);
    setCurrentSceneIndex(0);

    // Stop any ongoing speech synthesis
    window.speechSynthesis.cancel();

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      // 1. Generate story text
      setLoadingMessage('Crafting your narrative...');
      const storySchema = {
        type: Type.OBJECT,
        properties: {
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                sentence: {
                  type: Type.STRING,
                  description: "A single sentence for a story scene."
                },
              },
              required: ['sentence']
            }
          }
        },
        required: ['scenes']
      };

      const storyResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Generate a short, three-scene story based on the theme: "${prompt}". Each scene must be a single sentence.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: storySchema,
        },
      });

      const storyData = JSON.parse(storyResponse.text);
      if (!storyData.scenes || storyData.scenes.length < 3) {
          throw new Error("Could not generate a valid 3-scene story.");
      }
      const sceneTexts = storyData.scenes.slice(0, 3).map((s: any) => s.sentence);

      // 2. Generate images for each scene with consistency
      const generatedScenes: Scene[] = [];
      for (let i = 0; i < sceneTexts.length; i++) {
        setLoadingMessage(`Illustrating Scene ${i + 1}/${sceneTexts.length}...`);
        
        const imagePromptParts = [];

        // For scenes after the first, add the previous image as context
        if (i > 0 && generatedScenes[i-1]) {
            const previousImageUrl = generatedScenes[i-1].imageUrl;
            // Extract base64 data and mimeType from the data URL
            const [header, base64Data] = previousImageUrl.split(',');
            const mimeTypeMatch = header.match(/:(.*?);/);
            if (mimeTypeMatch && mimeTypeMatch[1]) {
                 const mimeType = mimeTypeMatch[1];
                 imagePromptParts.push({
                    inlineData: {
                        data: base64Data,
                        mimeType: mimeType,
                    },
                });
            }
        }
        
        // Add the text prompt for the current scene, making it more dynamic
        let textPrompt = '';
        if (i > 0) {
            textPrompt = `Continue the story from the previous image. Keep the same characters and art style, but illustrate this new action: "${sceneTexts[i]}". Show a clear change or progression in the scene based on the text.`;
        } else {
            textPrompt = `A vibrant, children's storybook illustration for the following scene: "${sceneTexts[i]}"`;
        }
        imagePromptParts.push({ text: textPrompt });

        const imageResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image-preview',
            contents: {
                parts: imagePromptParts,
            },
            config: {
                responseModalities: [Modality.IMAGE, Modality.TEXT],
            },
        });
        
        const imagePart = imageResponse.candidates[0].content.parts.find(part => part.inlineData);
        if (!imagePart || !imagePart.inlineData) {
            throw new Error(`Failed to generate an image for scene ${i + 1}.`);
        }
        
        const base64Image = imagePart.inlineData.data;
        const mimeType = imagePart.inlineData.mimeType;
        const imageUrl = `data:${mimeType};base64,${base64Image}`;

        generatedScenes.push({
          text: sceneTexts[i],
          imageUrl,
        });
      }

      setStory(generatedScenes);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "An unknown error occurred.");
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };
  
  const handleStartOver = () => {
    setStory(null);
    setPrompt('');
    setError(null);
    setCurrentSceneIndex(0);
    window.speechSynthesis.cancel();
  };

  const currentScene = story ? story[currentSceneIndex] : null;

  return html`
    <div class="app-container">
      <div class="app-header">
        <h1>AI Illustrated Story</h1>
        <p>Your ideas brought to life with words, pictures, and sound.</p>
      </div>

      ${isLoading && html`<${Loader} message=${loadingMessage} />`}
      
      ${!isLoading && !story && html`
        <${PromptForm}
          prompt=${prompt}
          onPromptChange=${(e: any) => setPrompt(e.target.value)}
          onSubmit=${handleGenerateStory}
          disabled=${isLoading}
        />
      `}

      ${error && !isLoading && html`
        <div class="error-message">
            <p><strong>Oops! Something went wrong.</strong></p>
            <p>${error}</p>
            <button class="btn btn-secondary" style="margin-top: 1rem;" onClick=${handleStartOver}>Try Again</button>
        </div>
      `}
      
      ${!isLoading && story && currentScene && html`
        <${StoryViewer}
          story=${story}
          currentSceneIndex=${currentSceneIndex}
          setCurrentSceneIndex=${setCurrentSceneIndex}
          onStartOver=${handleStartOver}
        />
      `}
    </div>
  `;
}

// --- Child Components ---

function Loader({ message }: { message: string }) {
  return html`
    <div class="loader" aria-live="polite">
      <div class="spinner"></div>
      <p>${message}</p>
    </div>
  `;
}

function PromptForm({ prompt, onPromptChange, onSubmit, disabled }: {
    prompt: string,
    onPromptChange: (e: Event) => void,
    onSubmit: (e: Event) => void,
    disabled: boolean
}) {
  return html`
    <form class="prompt-form" onSubmit=${onSubmit}>
      <label for="prompt-input" class="sr-only">Story Theme</label>
      <input
        id="prompt-input"
        class="prompt-input"
        type="text"
        placeholder="e.g., A brave knight and a friendly dragon..."
        value=${prompt}
        onInput=${onPromptChange}
        disabled=${disabled}
        aria-label="Story theme input"
      />
      <button type="submit" class="btn btn-primary" disabled=${disabled}>
        Generate Story
      </button>
    </form>
  `;
}


function StoryViewer({ story, currentSceneIndex, setCurrentSceneIndex, onStartOver }: {
    story: Scene[],
    currentSceneIndex: number,
    setCurrentSceneIndex: (cb: (i: number) => number | number) => void,
    onStartOver: () => void
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasPlayedOnce, setHasPlayedOnce] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  
  const scene = story[currentSceneIndex];
  const totalScenes = story.length;

  const playStory = (fromIndex = 0) => {
    if (!('speechSynthesis' in window)) {
        alert("Sorry, your browser does not support text-to-speech.");
        return;
    }
    
    setIsPlaying(true);
    setHasPlayedOnce(true);
    
    const playScene = (index: number) => {
      if (index >= story.length) {
          setIsPlaying(false);
          return;
      }
      setCurrentSceneIndex(() => index);
      const utterance = new SpeechSynthesisUtterance(story[index].text);
      utterance.onend = () => {
          playScene(index + 1);
      };
      utterance.onerror = () => {
          console.error("Speech synthesis error");
          setIsPlaying(false);
      }
      window.speechSynthesis.speak(utterance);
    };

    window.speechSynthesis.cancel();
    playScene(fromIndex);
  };
  
  // Auto-play the story when it's first loaded
  useEffect(() => {
    playStory(0);
    // Cleanup function to stop speech when component unmounts
    return () => {
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
    };
  }, [story]); // Rerun only when the story itself changes

  const handleDownloadVideo = async () => {
      setIsDownloading(true);
      try {
        const canvas = document.createElement('canvas');
        // Define video dimensions - using a standard 16:9 aspect ratio
        const videoWidth = 1280;
        const videoHeight = 720;
        canvas.width = videoWidth;
        canvas.height = videoHeight;

        const stream = canvas.captureStream(30); // 30 FPS
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
        
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/mp4' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'ai-story.mp4';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        };

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Could not get canvas context");

        const loadImage = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
        });

        recorder.start();
        
        const SCENE_DURATION_MS = 5000; // 5 seconds per scene

        for (const scene of story) {
            const img = await loadImage(scene.imageUrl);
            
            // Draw image scaled to fit canvas
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, videoWidth, videoHeight);
            const imgAspectRatio = img.width / img.height;
            const canvasAspectRatio = videoWidth / videoHeight;
            let drawWidth, drawHeight, offsetX, offsetY;
            
            if (imgAspectRatio > canvasAspectRatio) {
                drawWidth = videoWidth;
                drawHeight = videoWidth / imgAspectRatio;
            } else {
                drawHeight = videoHeight;
                drawWidth = videoHeight * imgAspectRatio;
            }
            offsetX = (videoWidth - drawWidth) / 2;
            offsetY = (videoHeight - drawHeight) / 2;
            ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

            // Draw text overlay
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(0, videoHeight - 150, videoWidth, 150);
            ctx.fillStyle = 'white';
            ctx.font = '32px Poppins';
            ctx.textAlign = 'center';
            wrapText(ctx, scene.text, videoWidth / 2, videoHeight - 90, videoWidth - 40, 40);

            await new Promise(resolve => setTimeout(resolve, SCENE_DURATION_MS));
        }

        recorder.stop();
      } catch (err) {
        console.error("Failed to generate video:", err);
        alert("Could not generate video. See console for details.");
      } finally {
        setIsDownloading(false);
      }
  };

  const wrapText = (context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
      const words = text.split(' ');
      let line = '';
      for (let n = 0; n < words.length; n++) {
          const testLine = line + words[n] + ' ';
          const metrics = context.measureText(testLine);
          const testWidth = metrics.width;
          if (testWidth > maxWidth && n > 0) {
              context.fillText(line, x, y);
              line = words[n] + ' ';
              y += lineHeight;
          } else {
              line = testLine;
          }
      }
      context.fillText(line, x, y);
  };

  const onNext = () => setCurrentSceneIndex(i => Math.min(i + 1, totalScenes - 1));
  const onPrev = () => setCurrentSceneIndex(i => Math.max(i - 1, 0));

  return html`
    <div class="story-viewer">
      <div class="slide" role="region" aria-roledescription="slide" aria-label=${`Scene ${currentSceneIndex + 1} of ${totalScenes}`}>
        <div class="slide-content">
            <img src=${scene.imageUrl} alt="Illustration for the story scene" class="slide-image" />
            <p class="slide-text">${scene.text}</p>
        </div>
        
        <div class="navigation-controls">
            ${!isPlaying && hasPlayedOnce ? html`
              <div class="post-playback-controls">
                <button onClick=${() => playStory(0)} class="btn btn-primary" aria-label="Play story again">Play Again</button>
                <button onClick=${handleDownloadVideo} class="btn btn-secondary" disabled=${isDownloading}>
                    ${isDownloading ? 'Generating Video...' : 'Download Video'}
                </button>
              </div>
            ` : html`
                <button onClick=${onPrev} disabled=${currentSceneIndex === 0 || isPlaying} class="btn btn-secondary" aria-label="Previous scene">Previous</button>
                <span class="scene-counter" aria-label=${`Scene ${currentSceneIndex + 1} of ${totalScenes}`}>${currentSceneIndex + 1} / ${totalScenes}</span>
                <button onClick=${onNext} disabled=${currentSceneIndex === totalScenes - 1 || isPlaying} class="btn btn-secondary" aria-label="Next scene">Next</button>
            `}
        </div>
      </div>
       <button onClick=${onStartOver} class="btn btn-primary" style="margin-top: 1rem;">Start Over</button>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('root') as HTMLElement);