import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, getDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import GoalSettingView from "./features/goal/goal_setting_view/goal_setting_view_component.jsx";
import WritingComponent from "./features/writing/writing_component.jsx";
import {firebaseConfig} from "./config/default.jsx";

export default function App() {
    const [firebase, setFirebase] = useState({ app: null, auth: null, db: null, userId: null });
    const [isLoading, setIsLoading] = useState(true);
    const [view, setView] = useState('goalSetting');
    const [initialData, setInitialData] = useState({
        goalStructure: { metadata: { target_venue: '', working_title: '', keywords: [] }, paper_outline: [] },
        editorText: ''
    });

    const logEvent = useCallback(async (eventName, details = {}) => {
        if (!firebase.db || !firebase.userId) return;
        try {
            const logData = {
                eventName,
                timestamp: serverTimestamp(),
                ...details
            };
            await addDoc(collection(firebase.db, `artifacts/${firebaseConfig.appId}/users/${firebase.userId}/logs`), logData);
        } catch (error) {
            console.error("Error logging event:", error);
        }
    }, [firebase.db, firebase.userId]);

    useEffect(() => {
        if (!firebaseConfig.config) {
            console.error("Firebase config is missing.");
            setIsLoading(false);
            return;
        }
        
        const app = initializeApp(firebaseConfig.config);
        const auth = getAuth(app);
        const db = getFirestore(app);

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                setFirebase({ app, auth, db, userId: user.uid });
                const dataRef = doc(db, `artifacts/${firebase.appId}/users/${user.uid}/data/main_document`);
                const docSnap = await getDoc(dataRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    setInitialData({
                        goalStructure: data.goalStructure || initialData.goalStructure,
                        editorText: data.editorText || ''
                    });
                    setView('writing');
                }
                await logEvent('user_session_started');
                setIsLoading(false);
            } else {
                 if (firebaseConfig.initialAuthToken) {
                    signInWithCustomToken(auth, firebaseConfig.initialAuthToken).catch(err => {
                        console.error("Custom token sign-in failed, trying anonymous", err);
                        signInAnonymously(auth);
                    });
                } else {
                    signInAnonymously(auth);
                }
            }
        });
    }, []);
    
    const handleConfirmGoal = () => {
        logEvent('goal_setting_confirmed');
        setView('writing');

    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen bg-slate-100 text-slate-700">
                <div className={"flex flex-row gap-2 items-center"}>
                    <div>
                        <span className="loading loading-spinner loading-md"></span>
                    </div>
                    <div>
                        Loading...
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="w-screen h-screen">
            <div className={"p-4 w-full h-full"}>
                <div className={"border-1 border-gray-300 rounded overflow-hidden  w-full h-full"}>
                    {view === 'goalSetting' ? (
                        <GoalSettingView
                            goalStructure={initialData.goalStructure}
                            setGoalStructure={(updater) =>
                                setInitialData(p => {
                                    const gs =
                                        typeof updater === "function"
                                            ? updater(p.goalStructure) // 传函数时调用
                                            : updater;                 // 传对象时直接替换
                                    return { ...p, goalStructure: gs };
                                })
                            }
                            onConfirm={handleConfirmGoal}
                        />
                    ) : (
                        <WritingComponent
                            firebase={firebase}
                            initialData={initialData}
                            logEvent={logEvent}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
