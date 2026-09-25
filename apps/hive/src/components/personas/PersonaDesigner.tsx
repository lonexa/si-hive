import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Wand2, Send, RotateCcw } from 'lucide-react';

interface PersonaDesignerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (persona: { name: string; description: string; content: string }) => void;
}

interface Message {
  role: 'assistant' | 'user';
  text: string;
}

const QUESTIONS = [
  {
    key: 'role',
    question: "What role should this persona play? For example: senior backend engineer, security reviewer, data scientist, code reviewer, DevOps specialist.",
  },
  {
    key: 'expertise',
    question: "What are the key areas of expertise? List the specific domains, technologies, or frameworks this persona should be knowledgeable about.",
  },
  {
    key: 'style',
    question: "Any coding style preferences? Think about: naming conventions, patterns to prefer/avoid, level of abstraction, comment style, error handling approach.",
  },
  {
    key: 'priorities',
    question: "What should this persona prioritize when writing or reviewing code? For example: performance, readability, security, test coverage, simplicity, maintainability.",
  },
  {
    key: 'guidelines',
    question: "Any specific guidelines, rules, or behaviors? For example: always use TypeScript strict mode, prefer functional patterns, avoid ORMs, follow specific API conventions.",
  },
  {
    key: 'name',
    question: "What would you like to name this persona?",
  },
] as const;

function buildPersonaContent(answers: Record<string, string>): { name: string; description: string; content: string } {
  const name = answers['name'] || 'Custom Persona';
  const role = answers['role'] || '';
  const expertise = answers['expertise'] || '';
  const style = answers['style'] || '';
  const priorities = answers['priorities'] || '';
  const guidelines = answers['guidelines'] || '';

  const description = role ? `${role} persona` : 'Custom persona';

  const sections: string[] = [];

  if (role) {
    sections.push(`You are a ${role}. Approach all tasks from this perspective and bring your domain expertise to every interaction.`);
  }

  if (expertise) {
    sections.push(`## Areas of Expertise\n${expertise}`);
  }

  if (style) {
    sections.push(`## Coding Style\n${style}`);
  }

  if (priorities) {
    sections.push(`## Priorities\nWhen writing or reviewing code, prioritize the following:\n${priorities}`);
  }

  if (guidelines) {
    sections.push(`## Guidelines\n${guidelines}`);
  }

  return { name, description, content: sections.join('\n\n') };
}

export default function PersonaDesigner({ open, onOpenChange, onComplete }: PersonaDesignerProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [input, setInput] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ name: string; description: string; content: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([
        { role: 'assistant', text: "I'll help you design a persona step by step. Each persona defines how AI should behave when working on a project." },
        { role: 'assistant', text: QUESTIONS[0].question },
      ]);
      setCurrentStep(0);
      setAnswers({});
      setPreview(null);
    }
  }, [open, messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend() {
    if (!input.trim()) return;

    const answer = input.trim();
    setInput('');

    const newMessages: Message[] = [...messages, { role: 'user', text: answer }];
    const newAnswers = { ...answers, [QUESTIONS[currentStep].key]: answer };
    setAnswers(newAnswers);

    const nextStep = currentStep + 1;

    if (nextStep < QUESTIONS.length) {
      newMessages.push({ role: 'assistant', text: QUESTIONS[nextStep].question });
      setCurrentStep(nextStep);
    } else {
      const result = buildPersonaContent(newAnswers);
      setPreview(result);
      newMessages.push({ role: 'assistant', text: `Here's your persona "${result.name}". Review the preview below and click "Save Persona" to continue.` });
    }

    setMessages(newMessages);
  }

  function handleReset() {
    setMessages([
      { role: 'assistant', text: "Let's start over. I'll help you design a new persona." },
      { role: 'assistant', text: QUESTIONS[0].question },
    ]);
    setCurrentStep(0);
    setAnswers({});
    setPreview(null);
    setInput('');
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4" />
            Persona Designer
          </DialogTitle>
        </DialogHeader>

        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto space-y-3 py-2 min-h-[300px] max-h-[400px]">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Preview */}
        {preview && (
          <div className="border border-border rounded-md p-3 bg-muted/50">
            <div className="text-xs font-medium text-muted-foreground mb-2">Preview</div>
            <Textarea
              value={preview.content}
              onChange={(e) => setPreview({ ...preview, content: e.target.value })}
              className="font-mono text-xs min-h-[120px] bg-background"
            />
          </div>
        )}

        {/* Input */}
        {!preview ? (
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your answer..."
              className="flex-1"
              autoFocus
            />
            <Button size="icon" onClick={handleSend} disabled={!input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5">
            <RotateCcw className="h-3 w-3" />
            Start Over
          </Button>
          {preview && (
            <Button size="sm" onClick={() => onComplete(preview)}>
              Save Persona
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
