export default function ChatbotBubbleComponent({message, role}) {
    return (
        <div className={`max-w-[80%] p-3 rounded-lg break-words ${role === 'user' ? 'bg-blue-600 text-white self-end rounded-br-none' : 'bg-slate-200 text-slate-800 self-start rounded-bl-none'}`}>{message}</div>
    );
}