import { useCallback, useEffect, useRef, useState } from 'react';

import type { Question } from '@/shared/types';
import { NOTES_LABEL_PREFIX } from '@/modules/chat/utils/askQuestionNotes';

type FocusSnapshot = { step: number; open: boolean; otherOn: boolean; fullscreen: boolean };

/**
 * Per-question notes for chat's AskUserQuestionPanel, the panel that answers
 * an agent's questions. It lives in this fork-owned hook so the upstream panel
 * only wires it in: the notes text, which questions have the field open, what
 * gets sent, and when the field takes focus.
 *
 * Call it after the panel's own focus effects (container, "Other"): React runs
 * effects in call order, so this one can hand focus back to the notes field
 * after those have moved it.
 */
export function useAskQuestionNotes({
  questions,
  currentStep,
  otherOn,
  isFullscreen,
}: {
  questions: Question[];
  currentStep: number;
  /** Whether the current question's "Other" field is open. */
  otherOn: boolean;
  isFullscreen: boolean;
}) {
  // The notes written for each question (by index), kept as typed and
  // trimmed only when read, so whitespace mid-edit is not lost.
  const [texts, setTexts] = useState<Map<number, string>>(() => new Map());
  // Which questions have the field open. Not derivable from `texts`: a field
  // opened but still empty must stay open when the user comes back to it.
  const [openSteps, setOpenSteps] = useState<Set<number>>(() => new Set());

  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // Which text field the user typed in last, so a fullscreen toggle with both
  // fields open hands focus back to that one. Set on typing, not on focus:
  // the panel focusing "Other" by itself must not count as the user's choice.
  const lastTypedRef = useRef<'other' | 'notes' | null>(null);
  // The previous render's inputs, so the focus effect can tell which one
  // changed — it reacts to the field opening, a step change or a fullscreen
  // toggle, never to options being picked.
  const prevRef = useRef<FocusSnapshot | null>(null);

  const isOpen = openSteps.has(currentStep);
  const text = texts.get(currentStep) || '';

  const focusField = useCallback(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    // A re-mounted field (fullscreen) would otherwise put the caret before
    // the text already written.
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { step: currentStep, open: isOpen, otherOn, fullscreen: isFullscreen };
    if (!prev || !isOpen) return;

    const stepChanged = prev.step !== currentStep;
    if (!stepChanged && otherOn && !prev.otherOn) {
      // "Other" was just opened next to the notes: it takes the focus.
      lastTypedRef.current = 'other';
      return;
    }
    const justOpened = !stepChanged && !prev.open;
    const fullscreenToggled = prev.fullscreen !== isFullscreen;
    const notesWin = !otherOn || lastTypedRef.current === 'notes';
    if (justOpened || ((stepChanged || fullscreenToggled) && notesWin)) {
      focusField();
    }
  }, [currentStep, isOpen, otherOn, isFullscreen, focusField]);

  const open = useCallback(() => {
    lastTypedRef.current = 'notes';
    if (openSteps.has(currentStep)) {
      focusField();
      return;
    }
    setOpenSteps(prev => new Set(prev).add(currentStep));
  }, [openSteps, currentStep, focusField]);

  const setText = useCallback((value: string) => {
    lastTypedRef.current = 'notes';
    setTexts(prev => new Map(prev).set(currentStep, value));
  }, [currentStep]);

  /** For the panel's "Other" field: the user typed there, not in the notes. */
  const markOtherTyped = useCallback(() => {
    lastTypedRef.current = 'other';
  }, []);

  // Claude's form: notes keyed by question text, like the answers.
  const buildAnnotations = useCallback(() => {
    const annotations: Record<string, { notes: string }> = {};
    questions.forEach((q, idx) => {
      const notes = (texts.get(idx) || '').trim();
      if (notes) annotations[q.question] = { notes };
    });
    return annotations;
  }, [questions, texts]);

  // OpenCode's form: one trailing `notes: …` entry in the question's label list.
  const labelFor = useCallback((idx: number): string | null => {
    const notes = (texts.get(idx) || '').trim();
    return notes ? `${NOTES_LABEL_PREFIX}${notes}` : null;
  }, [texts]);

  return {
    isOpen,
    text,
    hasText: text.trim().length > 0,
    hasAnyText: Array.from(texts.values()).some(value => value.trim().length > 0),
    fieldRef,
    open,
    setText,
    markOtherTyped,
    buildAnnotations,
    labelFor,
  };
}
