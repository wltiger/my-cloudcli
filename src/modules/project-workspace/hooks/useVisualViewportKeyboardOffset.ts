import { useEffect } from 'react';

/** Keeps the fixed workspace shell above the virtual keyboard in iOS Safari. */
export function useVisualViewportKeyboardOffset() {
  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) {
      return undefined;
    }

    // window.innerHeight and visualViewport.height aren't guaranteed to match
    // with the keyboard closed — on standalone iOS PWAs they can differ by a
    // constant, non-keyboard amount (e.g. disagreement over whether the
    // home-indicator area counts). Track the smallest delta ever observed as
    // the "no keyboard" baseline and only report the amount beyond it, so that
    // constant offset doesn't read as a permanent phantom keyboard height.
    let baseline = window.innerHeight - visualViewport.height;
    let rafId: number | null = null;

    const updateKeyboardHeight = () => {
      // Wait two frames before reading: the viewport meta's
      // interactive-widget=resizes-content already shrinks window.innerHeight
      // natively for the keyboard, but on standalone iOS PWAs it doesn't always
      // settle in the same tick as this resize event. A same-tick read can catch
      // window.innerHeight mid-transition and stack a second shift on top of the
      // native one, so the container gets pushed up twice.
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          const delta = window.innerHeight - visualViewport.height;
          baseline = Math.min(baseline, delta);
          const keyboardHeight = Math.max(0, delta - baseline);
          document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
        });
      });
    };

    visualViewport.addEventListener('resize', updateKeyboardHeight);
    return () => {
      visualViewport.removeEventListener('resize', updateKeyboardHeight);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);
}
