/**
 * useCopyToClipboard - Custom hook for clipboard operations with visual feedback
 */

import { useState, useCallback, useRef } from 'react';

interface UseCopyToClipboardResult {
  /** Whether the content was recently copied (true for ~2 seconds after copy) */
  copied: boolean;
  /** Function to copy content to clipboard */
  copyToClipboard: (content: string) => Promise<boolean>;
}

/**
 * Custom hook that provides clipboard functionality with visual feedback state.
 * Uses the modern Clipboard API with a fallback for older browsers.
 * 
 * @returns Object containing `copied` state and `copyToClipboard` function
 */
export function useCopyToClipboard(): UseCopyToClipboardResult {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyToClipboard = useCallback(async (content: string): Promise<boolean> => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    let success = false;

    // Try modern Clipboard API first
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(content);
        success = true;
      } catch (error) {
        console.error('Failed to copy to clipboard using navigator.clipboard:', error);
        // Fall through to fallback
      }
    }

    // Fallback for older browsers or if modern API failed
    if (!success) {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = content;
        textarea.setAttribute('readonly', '');
        // Position off-screen to avoid visual glitches
        textarea.style.position = 'fixed';
        textarea.style.top = '-9999px';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        
        try {
          success = document.execCommand('copy');
          if (!success) {
            console.error('Fallback: document.execCommand("copy") returned false.');
          }
        } catch (execError) {
          console.error('Fallback: Failed to copy using document.execCommand("copy"):', execError);
        } finally {
          if (textarea.parentNode) {
            textarea.parentNode.removeChild(textarea);
          }
        }
      } catch (fallbackError) {
        console.error('Fallback: Failed to create textarea for copy:', fallbackError);
      }
    }

    // Provide user feedback
    if (success) {
      setCopied(true);
      timeoutRef.current = setTimeout(() => {
        setCopied(false);
        timeoutRef.current = null;
      }, 2000);
    } else {
      // Alert user on failure
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert('Failed to copy logs to clipboard. Please copy them manually.');
      }
    }

    return success;
  }, []);

  return { copied, copyToClipboard };
}
