# @tiptaptop/extension-mention

Hi! This is an extension for [tiptap](https://github.com/ueberdosis/tiptap). It adds a "mention" element with custom formatting and suggestions.

Sorry in advance, this isn't well documented yet, but hopefuly it can help you get started on your own version.

## Usage

I'm primarily sharing this repo to show it off, but I will eventually publish an installable version on npm. Until then, you can just copy and paste the mention.ts file into your own project, and import it wherever you use a tiptap editor. For example:

```ts
import { Mention } from '...path...to/mention';
...
const editor  = new Editor({
      extensions: [
          Underline,
          Mention.configure({
              render: () => {
                  return {
                      onStart: (props: MentionProps) => {
                          // handle suggestions yourself
                          // props contains the query the user is typing
                          // Whatever you implement for the suggestions, can use the props.command() to pass the data back into the extension, which will then insert it into the text
                      },
                      onUpdate: (props: MentionProps) => {
                          // update the suggestions
                          // props contains the query
                      },
                      onKeyDown: ({ event }) => {
                          // return `true` for any `event.key` keydowns that you want the extension to ignore (useful for arrow up, down, tab, etc within the suggestion list)
                      },
                      onExit: (props: MentionProps) => {
                          // hide the suggestions
                      },
                  }
              },
              handleMentionClick: (mention) => {
                  // your own implementation here, eg. this.onMentionClick(mention.id);
              }
          }),
      ],
});
```
