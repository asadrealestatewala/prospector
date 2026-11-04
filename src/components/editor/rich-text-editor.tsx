"use client";
import * as React from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading2, Italic, Link2, List, ListOrdered, Quote, Underline } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Rich body editor for email templates (SRS screen 9). Produces only the tags the sender keeps
 * (paragraphs, bold, italic, underline, lists, headings, quotes, links); the server cleans it again.
 */
export function RichTextEditor({
  id,
  value,
  onChange,
  dir = "ltr",
  insertRef,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (html: string) => void;
  dir?: "ltr" | "rtl";
  /** Lets the parent insert text (such as a variable) at the cursor. */
  insertRef?: React.MutableRefObject<((text: string) => void) | null>;
  invalid?: boolean;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"], HTMLAttributes: { rel: null, target: null } },
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        id,
        dir,
        role: "textbox",
        "aria-multiline": "true",
        "aria-invalid": invalid ? "true" : "false",
        class: "prose-email min-h-64 px-3 py-2 text-body text-fg focus:outline-none",
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  React.useEffect(() => {
    if (!editor) return;
    editor.setOptions({ editorProps: { attributes: { id, dir, role: "textbox", "aria-multiline": "true", "aria-invalid": invalid ? "true" : "false", class: "prose-email min-h-64 px-3 py-2 text-body text-fg focus:outline-none" } } });
  }, [editor, dir, id, invalid]);

  React.useEffect(() => {
    if (!insertRef) return;
    insertRef.current = (text: string) => editor?.chain().focus().insertContent(text).run();
    return () => {
      insertRef.current = null;
    };
  }, [editor, insertRef]);

  return (
    <div className={cn("rounded-control border border-border bg-surface focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-600", invalid && "border-error")}>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  const btn = (label: string, icon: React.ReactNode, active: boolean, run: () => void) => (
    <Button type="button" variant="ghost" size="icon" aria-label={label} title={label} aria-pressed={active} className={cn("size-8", active && "bg-brand-50 text-brand-700")} onClick={run} disabled={!editor}>
      {icon}
    </Button>
  );
  const e = editor;
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1" role="toolbar" aria-label="Formatting">
      {btn("Bold", <Bold />, !!e?.isActive("bold"), () => e?.chain().focus().toggleBold().run())}
      {btn("Italic", <Italic />, !!e?.isActive("italic"), () => e?.chain().focus().toggleItalic().run())}
      {btn("Underline", <Underline />, !!e?.isActive("underline"), () => e?.chain().focus().toggleUnderline().run())}
      {btn("Heading", <Heading2 />, !!e?.isActive("heading", { level: 2 }), () => e?.chain().focus().toggleHeading({ level: 2 }).run())}
      {btn("Bulleted list", <List />, !!e?.isActive("bulletList"), () => e?.chain().focus().toggleBulletList().run())}
      {btn("Numbered list", <ListOrdered />, !!e?.isActive("orderedList"), () => e?.chain().focus().toggleOrderedList().run())}
      {btn("Quote", <Quote />, !!e?.isActive("blockquote"), () => e?.chain().focus().toggleBlockquote().run())}
      {btn("Link", <Link2 />, !!e?.isActive("link"), () => {
        if (!e) return;
        if (e.isActive("link")) {
          e.chain().focus().unsetLink().run();
          return;
        }
        const url = window.prompt("Link address (https://…)");
        if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) e.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
      })}
    </div>
  );
}
