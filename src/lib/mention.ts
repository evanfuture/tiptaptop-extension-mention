import { Attribute, Editor, mergeAttributes, Node, Range } from '@tiptap/core';
import { Node as ProseMirrorNode, ResolvedPos } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';

export interface SuggestionMatch {
  range: Range;
  query: string;
  text: string;
}

export interface MentionProps {
  editor: Editor;
  range: Range;
  query: string;
  text: string;
  command: (props: Record<string, string>) => void;
  decorationId: () => string;
}

export interface MentionOptions {
  HTMLAttributes: Record<string, any>;
  renderLabel: (props: { node: ProseMirrorNode }) => string;
  handleMentionClick?: (mention: any) => void;
  command?: (props: { editor: Editor; range: Range; props: any }) => void;
  render?: () => {
    onStart?: (props: MentionProps) => void;
    onUpdate?: (props: MentionProps) => void;
    onExit?: (props: MentionProps) => void;
    onKeyDown?: (props: { view: EditorView; event: KeyboardEvent; range: Range }) => boolean;
  };
  allow?: (props: { editor: Editor; range: Range }) => boolean;
}

const getStandardAttribute = (key: string): Attribute => {
  return {
    default: null,
    parseHTML: element => {
      return element.getAttribute(`data-${key}`);
    },
    renderHTML: attributes => {
      if (!attributes[key]) {
        return {};
      }

      return {
        [`data-${key}`]: attributes[key],
      };
    },
    keepOnSplit: true,
  };
};
const findSuggestionMatch = ($position: ResolvedPos): SuggestionMatch => {
  const char = '@';
  const allowedChars = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9'",()\-\s]*$/;
  const disallowedStartsWithChars = /^[,\s]/;
  // Matching expressions used for later
  const escapedChar = char
    .split('')
    .map(c => `\\${c}`)
    .join('');
  const suffix = new RegExp(`\\s${escapedChar}$`);
  const regexp = new RegExp(`${escapedChar}.*?(?=\\s${escapedChar}|$)`, 'gm');

  const isTopLevelNode = $position.depth <= 0;
  const textFrom = isTopLevelNode ? 0 : $position.before();
  const textTo = $position.pos;
  const text = $position.doc.textBetween(textFrom, textTo, '\0', '\0');
  const match = Array.from(text.matchAll(regexp)).pop();
  const textAfter = text.split(char)[1];
  const allowed = allowedChars.test(textAfter) && !disallowedStartsWithChars.test(textAfter);

  if (!match || match.input === undefined || match.index === undefined || !allowed) {
    return null;
  }

  // JavaScript doesn't have lookbehinds; this hacks a check that first character is " "
  // or the line beginning
  const matchPrefix = match.input.slice(Math.max(0, match.index - 1), match.index);

  if (!/^[\s\0]?$/.test(matchPrefix)) {
    return null;
  }

  // The absolute position of the match in the document
  const from = match.index + $position.start();
  let to = from + match[0].length;

  // Edge case handling; if spaces are allowed and we're directly in between
  // two triggers
  if (suffix.test(text.slice(to - 1, to + 1))) {
    match[0] += ' ';
    to += 1;
  }

  // If the $position is located within the matched substring, return that range
  if (from < $position.pos && to >= $position.pos) {
    return {
      range: {
        from,
        to,
      },
      query: match[0].slice(char.length),
      text: match[0],
    };
  }

  return null;
};

export const Mention = Node.create<MentionOptions>({
  name: 'mention',
  group: 'inline',
  inline: true,
  selectable: true,
  atom: true,

  defaultOptions: {
    HTMLAttributes: {
      class: 'dm-mention',
    },
    renderLabel: ({ node }) => node.attrs.value,
    allow: ({ editor, range }) => editor.can().insertContentAt(range, { type: 'mention' }),
  },

  addAttributes() {
    return {
      id: getStandardAttribute('id'),
      collection: getStandardAttribute('collection'),
      value: getStandardAttribute('value'),
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-mention]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes({ 'data-mention': '' }, this.options.HTMLAttributes, HTMLAttributes),
      this.options.renderLabel({ node }),
    ];
  },

  renderText({ node }) {
    return this.options.renderLabel({ node });
  },

  addProseMirrorPlugins() {
    const renderer = this.options.render?.();
    const options = this.options;
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey('mention'),

        view() {
          return {
            update: async (view, prevState) => {
              const prev = this.key.getState(prevState);
              const next = this.key.getState(view.state);

              // See how the state changed
              const moved = prev.active && next.active && prev.range.from !== next.range.from;
              const started = !prev.active && next.active;
              const stopped = prev.active && !next.active;
              const changed = !started && !stopped && prev.query !== next.query;
              const handleStart = started || moved;
              const handleChange = changed && !moved;
              const handleExit = stopped || moved;

              // Cancel when suggestion isn't active
              if (!handleStart && !handleChange && !handleExit) {
                return;
              }

              const state = handleExit && !handleStart ? prev : next;
              const props: MentionProps = {
                editor,
                range: state.range,
                query: state.query,
                text: state.text,
                command: (mentionProps: Record<string, string>) => {
                  // increase range.to by one when the next node is of type "text"
                  // and starts with a space character
                  const nodeAfter = editor.view.state.selection.$to.nodeAfter;
                  const shouldOverrideSpace = nodeAfter?.text?.startsWith(' ');

                  if (shouldOverrideSpace) {
                    state.range.to += 1;
                  }
                  editor
                    .chain()
                    .focus()
                    .insertContentAt(state.range, [
                      {
                        type: 'mention',
                        attrs: mentionProps,
                      },
                      {
                        type: 'text',
                        text: ' ',
                      },
                    ])
                    .run();
                },
                decorationId: () => {
                  const { decorationId } = this.key.getState(editor.state);

                  return decorationId ? `[data-decoration-id="${decorationId}"]` : null;
                },
              };

              if (handleExit) {
                renderer?.onExit?.(props);
              }

              if (handleChange) {
                renderer?.onUpdate?.(props);
              }

              if (handleStart) {
                renderer?.onStart?.(props);
              }
            },
          };
        },

        state: {
          // Initialize the plugin's internal state.
          init() {
            return {
              active: false,
              range: {},
              query: null,
              text: null,
              decorationId: null,
            };
          },

          // Apply changes to the plugin state from a view transaction.
          apply: (transaction, prev) => {
            const { selection } = transaction;
            const { empty } = selection;

            if (empty || editor.view.composing) {
              const match = findSuggestionMatch(selection.$from);

              if (match && options.allow?.({ editor, range: match.range })) {
                return {
                  active: true,
                  range: match.range,
                  query: match.query,
                  text: match.text,
                  decorationId: prev.decorationId ? prev.decorationId : `id_${Math.floor(Math.random() * 0xffffffff)}`,
                };
              }
            }

            return { active: false, range: {}, query: null, text: null, decorationId: null };
          },
        },

        props: {
          handleKeyDown(view, event) {
            const { active, range } = this.getState(view.state);

            if (!active) {
              return false;
            }

            return renderer?.onKeyDown?.({ view, event, range }) || false;
          },
          handleClickOn: (_view, _pos, node, _nodePos, _event, isDirect) => {
            if (node.type.name === this.name && isDirect) {
              const mention = node.attrs;
              options.handleMentionClick?.(mention);
              return true;
            }
            return false;
          },

          decorations(state) {
            const { active, range, decorationId } = this.getState(state);

            if (!active) {
              return null;
            }

            return DecorationSet.create(state.doc, [
              Decoration.inline(range.from, range.to, {
                nodeName: 'span',
                'data-decoration-id': decorationId,
              }),
            ]);
          },
        },
      }),
    ];
  },
});
