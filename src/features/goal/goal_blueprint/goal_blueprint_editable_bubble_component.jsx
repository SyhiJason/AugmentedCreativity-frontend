import {useEffect, useRef, useState} from "react";

export default function GoalBlueprintEditableBubbleComponent({ path, text, onUpdate, extraClasses = '' }) {
    const [isEditing, setIsEditing] = useState(false);
    const [value, setValue] = useState(text);
    const inputRef = useRef(null);

    useEffect(() => { setValue(text); }, [text]);

    useEffect(() => {
        if (isEditing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [isEditing]);

    const handleDone = () => {
        setIsEditing(false);
        onUpdate(path, value);
    };

    return isEditing ? (
        <input
            ref={inputRef}
            value={value}
            onChange={e => setValue(e.target.value)}
            onBlur={handleDone}
            onKeyDown={e => e.key === 'Enter' && handleDone()}
            className={`w-full bg-slate-200 text-slate-800 rounded-md p-2 ${extraClasses}`}
        />
    ) : (
        <div onDoubleClick={() => setIsEditing(true)} className={`goal-bubble-light ${extraClasses}`}>{text}</div>
    );
}