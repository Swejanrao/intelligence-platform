import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Activity, Archive, ArrowLeft, ArrowRight, BarChart3, BookOpen, Check, CircleHelp,
  Clock3, FilePlus2, Flag, LayoutDashboard, LogOut, PenLine, Plus, Search, ShieldCheck, Timer, Users, X
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const client = axios.create({ baseURL: API_URL });
const tokenKey = "assessment-platform-token";
const userKey = "assessment-platform-user";
const attemptKey = "assessment-platform-attempt";

type User = { id: string; name: string; email: string; role: "ADMIN" | "CANDIDATE" };
type Category = { id: string; name: string };
type Dimension = { id: string; name: string };
type Option = { id?: string; text: string; isCorrect?: boolean; scoreValue?: number | null };
type Mapping = { dimensionId: string; weight: number; reverseScored: boolean; dimension?: Dimension };
type Question = {
  id: string; text: string; type: string; categoryId: string; category: Category; difficulty: string;
  status: string; marks: number; negativeMarks: number; topic?: string | null; skill?: string | null;
  options: Option[]; dimensionMappings: Mapping[];
};
type Assessment = {
  id: string; title: string; description?: string; type: "TECHNICAL" | "PSYCHOMETRIC";
  status: string; durationMinutes: number; negativeMarking: boolean;
  sections: { id: string; title: string; position: number }[];
  blueprints?: { id: string; sectionId: string; section: { id: string; title: string }; category: Category; difficulty: string; requiredCount: number; availableCount?: number; short?: boolean }[];
  _count?: { attempts: number };
};
type AttemptQuestion = {
  id: string; questionText: string; questionType: string; options: { id: string; text: string }[];
  displayOrder: number; flagged: boolean; section: { id: string; title: string }; answer: unknown;
};
type Attempt = {
  id: string; assessmentId: string; assessmentTitle: string; durationMinutes: number;
  status: string; startedAt: string; expiresAt: string; questions: AttemptQuestion[];
};
type Result = {
  attemptId: string; assessmentId?: string; technicalScore: number; maximumScore: number; percentage: number;
  candidate?: { id: string; name: string; email: string };
  assessment?: { id: string; title: string; type: string };
  sectionScores: { sectionId?: string; sectionTitle: string; score: number; maximumScore: number }[];
  dimensionScores: { id?: string; name: string; score: number; responseCount?: number }[];
  illustrativeNotice: string; calculatedAt: string;
};
type QuestionForm = {
  text: string; type: string; categoryId: string; difficulty: string; topic: string; skill: string;
  marks: number; negativeMarks: number; options: Option[]; dimensions: { dimensionId: string; weight: number; reverseScored: boolean }[];
};
type AssessmentForm = {
  title: string; description: string; type: string; durationMinutes: number; negativeMarking: boolean;
  sections: { id?: string; title: string; quotas: { categoryId: string; difficulty: string; requiredCount: number }[] }[];
};

const blankQuestion: QuestionForm = {
  text: "", type: "SINGLE_CHOICE", categoryId: "", difficulty: "EASY", topic: "", skill: "",
  marks: 1, negativeMarks: 0, options: [{ text: "", isCorrect: true }, { text: "", isCorrect: false }],
  dimensions: []
};

function apiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.error?.message || error.message || "The request failed";
  }
  return error instanceof Error ? error.message : "The request failed";
}

function getErrorMessage(error: unknown): string {
  return apiError(error);
}

export default function App() {
  const [user, setUser] = useState<User | null>(() => {
    try { return JSON.parse(localStorage.getItem(userKey) || "null") as User | null; } catch { return null; }
  });
  const [token, setToken] = useState(() => localStorage.getItem(tokenKey) || "");
  const [page, setPage] = useState("overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [selectedAssessment, setSelectedAssessment] = useState<Assessment | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [reviewResult, setReviewResult] = useState<Result | null>(null);
  const [activeAttemptId, setActiveAttemptId] = useState(() => localStorage.getItem(attemptKey) || "");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [questionForm, setQuestionForm] = useState<QuestionForm>(blankQuestion);
  const [editingQuestion, setEditingQuestion] = useState<string | null>(null);
  const [showQuestionForm, setShowQuestionForm] = useState(false);
  const [showAssessmentForm, setShowAssessmentForm] = useState(false);
  const [editingAssessmentId, setEditingAssessmentId] = useState<string | null>(null);
  const [assessmentForm, setAssessmentForm] = useState<AssessmentForm>({
    title: "", description: "", type: "TECHNICAL", durationMinutes: 30, negativeMarking: true,
    sections: [{ title: "General", quotas: [{ categoryId: "", difficulty: "EASY", requiredCount: 2 }] }]
  });
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [answerState, setAnswerState] = useState<Record<string, "saved" | "saving" | "failed">>({});
  const [showReview, setShowReview] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<Question | null>(null);
  const saveQueue = useRef(new Map<string, Promise<void>>());

  const request = useCallback(async <T,>(method: "get" | "post" | "put" | "patch", path: string, data?: unknown) => {
    const response = await client.request<T>({
      method, url: path, data, headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
    return response.data;
  }, [token]);

  const refresh = useCallback(async () => {
    if (!user) return;
    setError("");
    try {
      if (user.role === "ADMIN") {
        const [categoryData, dimensionData, questionData, assessmentRows] = await Promise.all([
          request<Category[]>("get", "/categories"),
          request<Dimension[]>("get", "/dimensions"),
          request<Question[]>("get", `/questions?status=${statusFilter}${categoryFilter ? `&categoryId=${categoryFilter}` : ""}${difficultyFilter ? `&difficulty=${difficultyFilter}` : ""}${query ? `&search=${encodeURIComponent(query)}` : ""}`),
          request<Assessment[]>("get", "/assessments")
        ]);
        const assessmentData = await Promise.all(assessmentRows.map((assessment) =>
          request<Assessment>("get", `/assessments/${assessment.id}`)
        ));
        setCategories(categoryData);
        setDimensions(dimensionData);
        setQuestions(questionData);
        setAssessments(assessmentData);
        if (page === "results" || page === "overview") {
          setResults(await request<Result[]>("get", "/results"));
        }
      } else {
        setAssessments(await request<Assessment[]>("get", "/assessments"));
      }
    } catch (reason) {
      setError(getErrorMessage(reason));
    }
  }, [user, request, statusFilter, difficultyFilter, categoryFilter, query, page]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!user || user.role !== "CANDIDATE" || !activeAttemptId) return;
    request<Attempt>("get", `/attempts/${activeAttemptId}`).then(async (active) => {
      setAttempt(active);
      setCurrentQuestion((index) => Math.min(index, Math.max(active.questions.length - 1, 0)));
      if (active.status === "SUBMITTED") {
        setResult(await request<Result>("get", `/attempts/${active.id}/result`));
        setPage("result");
      } else {
        setPage("attempt");
      }
    }).catch((reason) => {
      setError(getErrorMessage(reason));
      setActiveAttemptId("");
      localStorage.removeItem(attemptKey);
    });
  }, [user, activeAttemptId, request]);

  useEffect(() => {
    if (!attempt || attempt.status !== "IN_PROGRESS") return;
    const updateTime = () => {
      const seconds = Math.max(0, Math.floor((new Date(attempt.expiresAt).getTime() - Date.now()) / 1000));
      setRemainingSeconds(seconds);
      if (seconds === 0) void completeAttempt();
    };
    updateTime();
    const timerId = window.setInterval(updateTime, 1000);
    return () => window.clearInterval(timerId);
  }, [attempt?.id, attempt?.expiresAt, attempt?.status]);

  useEffect(() => {
    if (!notice) return;
    const timerId = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timerId);
  }, [notice]);

  const filteredQuestions = useMemo(() => questions, [questions]);
  const activeQuestion = attempt?.questions[currentQuestion];
  const minutesLeft = Math.ceil(remainingSeconds / 60);
  const isTimerWarning = remainingSeconds <= 300;

  function signOut() {
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(userKey);
    localStorage.removeItem(attemptKey);
    setToken("");
    setUser(null);
    setAttempt(null);
    setResult(null);
    saveQueue.current.clear();
    setPage("overview");
  }

  async function signIn(email: string, password: string) {
    setBusy(true);
    setError("");
    try {
      const response = await client.post<{ token: string; user: User }>("/auth/sign-in", { email, password });
      localStorage.setItem(tokenKey, response.data.token);
      localStorage.setItem(userKey, JSON.stringify(response.data.user));
      setToken(response.data.token);
      setUser(response.data.user);
      setPage("overview");
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  function editQuestion(question?: Question) {
    if (!question) {
      setEditingQuestion(null);
      setQuestionForm({ ...blankQuestion, categoryId: categories[0]?.id || "" });
    } else {
      setEditingQuestion(question.id);
      setQuestionForm({
        text: question.text, type: question.type, categoryId: question.categoryId, difficulty: question.difficulty,
        topic: question.topic || "", skill: question.skill || "", marks: question.marks,
        negativeMarks: question.negativeMarks,
        options: question.options.map(({ text, isCorrect, scoreValue }) => ({ text, isCorrect: !!isCorrect, scoreValue })),
        dimensions: question.dimensionMappings.map(({ dimensionId, weight, reverseScored }) => ({ dimensionId, weight, reverseScored }))
      });
    }
    setShowQuestionForm(true);
  }

  async function saveQuestion(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = {
        ...questionForm,
        topic: questionForm.topic || null,
        skill: questionForm.skill || null,
        options: ["LIKERT"].includes(questionForm.type) ? [] : questionForm.options
      };
      await request(editingQuestion ? "patch" : "post", editingQuestion ? `/questions/${editingQuestion}` : "/questions", body);
      setShowQuestionForm(false);
      setNotice(editingQuestion ? "Question updated" : "Question added");
      await refresh();
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function archiveQuestion(question: Question) {
    setBusy(true);
    try {
      await request("post", `/questions/${question.id}/archive`, { confirm: true });
      setConfirmArchive(null);
      setNotice("Question archived");
      await refresh();
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  function editAssessment(assessment: Assessment) {
    const sections = assessment.sections.map((section) => ({
      id: section.id,
      title: section.title,
      quotas: (assessment.blueprints || []).filter((row) => row.sectionId === section.id).map((row) => ({
        categoryId: row.category.id,
        difficulty: row.difficulty,
        requiredCount: row.requiredCount
      }))
    })).filter((section) => section.quotas.length > 0);
    setAssessmentForm({
      title: assessment.title,
      description: assessment.description || "",
      type: assessment.type,
      durationMinutes: assessment.durationMinutes,
      negativeMarking: assessment.negativeMarking,
      sections
    });
    setEditingAssessmentId(assessment.id);
    setShowAssessmentForm(true);
  }

  async function saveAssessment(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = {
        title: assessmentForm.title,
        description: assessmentForm.description,
        type: assessmentForm.type,
        durationMinutes: Number(assessmentForm.durationMinutes),
        negativeMarking: assessmentForm.type === "TECHNICAL" && assessmentForm.negativeMarking,
        sections: assessmentForm.sections.map((section) => ({
          title: section.title,
          quotas: section.quotas.map((quota) => ({
            ...quota,
            requiredCount: Number(quota.requiredCount)
          }))
        }))
      };
      if (editingAssessmentId) {
        await request("patch", `/assessments/${editingAssessmentId}`, {
          title: body.title,
          description: body.description,
          durationMinutes: body.durationMinutes,
          negativeMarking: body.negativeMarking
        });
        await request("put", `/assessments/${editingAssessmentId}/blueprint`, {
          rows: assessmentForm.sections.flatMap((section) => section.quotas.map((quota) => ({
            ...quota,
            sectionId: section.id
          })))
        });
      } else {
        await request("post", "/assessments", body);
      }
      setShowAssessmentForm(false);
      setEditingAssessmentId(null);
      setNotice(editingAssessmentId ? "Draft assessment updated" : "Draft assessment created");
      await refresh();
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function publishAssessment(assessment: Assessment) {
    setBusy(true);
    try {
      await request("post", `/assessments/${assessment.id}/publish`, {});
      setNotice("Assessment published and ready for candidates");
      await refresh();
    } catch (reason) {
      const message = getErrorMessage(reason);
      await refresh();
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function unpublishAssessment(assessment: Assessment) {
    setBusy(true);
    try {
      await request("post", `/assessments/${assessment.id}/unpublish`, {});
      setNotice("Assessment returned to draft");
      await refresh();
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function startAttempt(assessment: Assessment) {
    setBusy(true);
    setError("");
    try {
      const created = await request<Attempt>("post", `/assessments/${assessment.id}/attempts`, {});
      localStorage.setItem(attemptKey, created.id);
      setActiveAttemptId(created.id);
      setAttempt(created);
      saveQueue.current.clear();
      setCurrentQuestion(0);
      if (created.status === "SUBMITTED") {
        setResult(await request<Result>("get", `/attempts/${created.id}/result`));
        setPage("result");
      } else {
        setPage("attempt");
      }
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function saveAnswer(questionId: string, answer: unknown) {
    const storedAnswer = Array.isArray(answer) && answer.length === 0 ? null : answer;
    setAttempt((current) => current ? ({
      ...current,
      questions: current.questions.map((question) => question.id === questionId ? { ...question, answer: storedAnswer } : question)
    }) : current);
    const previous = saveQueue.current.get(questionId) || Promise.resolve();
    const pending = previous.catch(() => undefined).then(async () => {
      setAnswerState((state) => ({ ...state, [questionId]: "saving" }));
      await request("put", `/attempts/${attempt!.id}/responses`, { questionId, answer });
      setAnswerState((state) => ({ ...state, [questionId]: "saved" }));
      setError("");
    }).catch((reason) => {
      setAnswerState((state) => ({ ...state, [questionId]: "failed" }));
      setError(getErrorMessage(reason));
      throw reason;
    });
    saveQueue.current.set(questionId, pending);
    try { await pending; } catch { /* The save state is surfaced beside the question. */ }
  }

  async function toggleFlag(question: AttemptQuestion) {
    try {
      await request("patch", `/attempts/${attempt!.id}/flag`, { questionId: question.id, flagged: !question.flagged });
      setAttempt((current) => current ? ({
        ...current,
        questions: current.questions.map((item) => item.id === question.id ? { ...item, flagged: !item.flagged } : item)
      }) : current);
    } catch (reason) {
      setError(getErrorMessage(reason));
    }
  }

  async function completeAttempt() {
    if (!attempt) return;
    setBusy(true);
    try {
      const saveResults = await Promise.allSettled([...saveQueue.current.values()]);
      if (saveResults.some((save) => save.status === "rejected")) {
        setError("A response could not be saved. Return to that question and try again before submitting.");
        return;
      }
      const scored = await request<Result>("post", `/attempts/${attempt.id}/submit`, {});
      setResult(scored);
      setAttempt((current) => current ? { ...current, status: "SUBMITTED" } : current);
      setShowReview(false);
      setPage("result");
      setNotice("Your responses have been submitted");
    } catch (reason) {
      setError(getErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  const nav = user?.role === "ADMIN"
    ? [
      { id: "overview", label: "Overview", icon: LayoutDashboard },
      { id: "questions", label: "Question bank", icon: BookOpen },
      { id: "assessments", label: "Assessments", icon: FilePlus2 },
      { id: "results", label: "Results", icon: BarChart3 }
    ]
    : [{ id: "overview", label: "Assessments", icon: LayoutDashboard }];

  if (!user) return <SignIn onSubmit={signIn} busy={busy} error={error} />;

  if (page === "attempt" && attempt && activeQuestion) {
    const answeredCount = attempt.questions.filter((question) => question.answer !== null).length;
    const currentState = answerState[activeQuestion.id];
    return (
      <main className="candidate-shell">
        <header className="attempt-header">
          <div className="brand-mark small"><Activity size={19} /></div>
          <div className="attempt-title"><strong>{attempt.assessmentTitle}</strong><span>{activeQuestion.section.title}</span></div>
          <div className={`timer ${isTimerWarning ? "warning" : ""}`}><Timer size={17} /><span>{Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")}</span>{isTimerWarning && <b>5 minutes or less</b>}</div>
          <button className="button button-light" onClick={() => setShowReview(true)}>Review & submit <ArrowRight size={16} /></button>
        </header>
        <div className="candidate-progress"><span style={{ width: `${(answeredCount / attempt.questions.length) * 100}%` }} /></div>
        <section className="attempt-layout">
          <aside className="question-navigator">
            <h2>Question navigator</h2>
            <p>{answeredCount} of {attempt.questions.length} answered</p>
            <div className="navigator-grid">
              {attempt.questions.map((question, index) => (
                <button key={question.id} onClick={() => setCurrentQuestion(index)}
                  className={`navigator-chip ${index === currentQuestion ? "current" : ""} ${question.answer !== null ? "answered" : ""} ${question.flagged ? "flagged" : ""}`}
                  aria-label={`Question ${index + 1}${question.answer !== null ? ", answered" : ", unanswered"}${question.flagged ? ", flagged" : ""}`}>
                  {index + 1}{question.flagged && <Flag size={11} />}
                </button>
              ))}
            </div>
            <div className="navigator-legend"><span><i className="legend-dot answered" />Answered</span><span><i className="legend-dot" />Unanswered</span><span><i className="legend-dot flagged" />Flagged</span></div>
            <button className="button button-light full-width flag-control" onClick={() => void toggleFlag(activeQuestion)}>
              <Flag size={15} />{activeQuestion.flagged ? "Remove flag" : "Flag for review"}
            </button>
          </aside>
          <article className="question-panel">
            <div className="question-meta"><span>QUESTION {currentQuestion + 1} OF {attempt.questions.length}</span><span>{activeQuestion.questionType.replace(/_/g, " ")}</span></div>
            <h1>{activeQuestion.questionText}</h1>
            <AnswerControl question={activeQuestion} onAnswer={(answer) => void saveAnswer(activeQuestion.id, answer)} />
            <div className="save-status" aria-live="polite">
              {currentState === "saving" && <><span className="status-dot saving" />Saving response…</>}
              {currentState === "saved" && <><Check size={15} />Saved</>}
              {currentState === "failed" && <><CircleHelp size={15} />Save failed. Change your answer to retry.</>}
              {!currentState && activeQuestion.answer !== null && <><Check size={15} />Saved</>}
            </div>
            <div className="question-actions">
              <button className="button button-light" disabled={currentQuestion === 0} onClick={() => setCurrentQuestion((index) => Math.max(0, index - 1))}><ArrowLeft size={16} />Previous</button>
              {currentQuestion < attempt.questions.length - 1
                ? <button className="button button-primary" onClick={() => setCurrentQuestion((index) => index + 1)}>Next question <ArrowRight size={16} /></button>
                : <button className="button button-primary" onClick={() => setShowReview(true)}>Review answers <ArrowRight size={16} /></button>}
            </div>
          </article>
        </section>
        {showReview && <ReviewDialog attempt={attempt} busy={busy} onClose={() => setShowReview(false)} onSubmit={() => void completeAttempt()} onQuestion={(index) => { setCurrentQuestion(index); setShowReview(false); }} />}
        {error && <Toast message={error} onClose={() => setError("")} tone="error" />}
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="brand-mark"><Activity size={21} /></div><div><strong>Assessly</strong><span>INTELLIGENCE PLATFORM</span></div></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav">
          {nav.map(({ id, label, icon: Icon }) => (
            <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}><Icon size={18} /><span>{label}</span>{id === "results" && results.length > 0 && <small>{results.length}</small>}</button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="avatar">{user.name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</div>
          <div className="user-summary"><strong>{user.name}</strong><span>{user.role === "ADMIN" ? "Administrator" : "Candidate"}</span></div>
          <button className="icon-button logout" onClick={signOut} aria-label="Sign out"><LogOut size={17} /></button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span>/</span><strong>{pageLabel(page)}</strong></div><div className="topbar-right"><span className="secure-label"><ShieldCheck size={15} />Secure workspace</span><span className="avatar small-avatar">{user.name[0]}</span></div></header>
        <div className="page-body">
          {error && <div className="alert alert-error"><CircleHelp size={18} />{error}<button onClick={() => setError("")} aria-label="Dismiss"><X size={16} /></button></div>}
          {page === "overview" && user.role === "ADMIN" && <AdminOverview assessments={assessments} questions={questions} results={results} onNavigate={setPage} />}
          {page === "overview" && user.role === "CANDIDATE" && <CandidateDashboard assessments={assessments} busy={busy} onStart={setSelectedAssessment} />}
          {page === "questions" && user.role === "ADMIN" && (
            <QuestionBank questions={filteredQuestions} categories={categories} query={query} category={categoryFilter} difficulty={difficultyFilter} status={statusFilter}
              onQuery={setQuery} onCategory={setCategoryFilter} onDifficulty={setDifficultyFilter} onStatus={setStatusFilter} onCreate={() => editQuestion()}
              onEdit={editQuestion} onArchive={setConfirmArchive} />
          )}
          {page === "assessments" && user.role === "ADMIN" && <AssessmentList assessments={assessments} busy={busy} onCreate={() => { setEditingAssessmentId(null); setAssessmentForm((form) => ({ ...form, sections: form.sections.map((section) => ({ ...section, quotas: section.quotas.map((quota) => ({ ...quota, categoryId: quota.categoryId || categories[0]?.id || "" })) })) })); setShowAssessmentForm(true); }} onEdit={editAssessment} onPublish={publishAssessment} onUnpublish={unpublishAssessment} />}
          {page === "results" && user.role === "ADMIN" && <ResultsList results={results} onOpen={(item) => { setReviewResult(item); setPage("review-result"); }} />}
          {page === "result" && result && <ResultView result={result} candidate onBack={() => { setPage("overview"); setActiveAttemptId(""); localStorage.removeItem(attemptKey); setAttempt(null); saveQueue.current.clear(); }} />}
          {page === "review-result" && reviewResult && <ResultView result={reviewResult} onBack={() => setPage("results")} />}
        </div>
      </main>
      {showQuestionForm && <QuestionModal form={questionForm} setForm={setQuestionForm} categories={categories} dimensions={dimensions} editing={!!editingQuestion} busy={busy} onClose={() => setShowQuestionForm(false)} onSubmit={saveQuestion} />}
      {showAssessmentForm && <AssessmentModal form={assessmentForm} setForm={setAssessmentForm} categories={categories} busy={busy} editing={!!editingAssessmentId} onClose={() => { setShowAssessmentForm(false); setEditingAssessmentId(null); }} onSubmit={saveAssessment} />}
      {selectedAssessment && <InstructionDialog assessment={selectedAssessment} busy={busy} onClose={() => setSelectedAssessment(null)} onStart={() => { const selected = selectedAssessment; setSelectedAssessment(null); void startAttempt(selected); }} />}
      {confirmArchive && <ConfirmDialog title="Archive question?" description="Archived questions are excluded from future attempts. Existing attempts keep their saved snapshot." busy={busy} onCancel={() => setConfirmArchive(null)} onConfirm={() => void archiveQuestion(confirmArchive)} />}
      {notice && <Toast message={notice} onClose={() => setNotice("")} />}
    </div>
  );
}

function pageLabel(page: string) {
  return ({ overview: "Overview", questions: "Question bank", assessments: "Assessments", results: "Results", result: "Result summary" } as Record<string, string>)[page] || page;
}

function SignIn({ onSubmit, busy, error }: { onSubmit: (email: string, password: string) => void; busy: boolean; error: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return <main className="login-page">
    <div className="login-card">
      <div className="login-brand"><div className="brand-mark"><Activity size={23} /></div><span>ASSESSLY</span></div>
      <p className="eyebrow">ASSESSMENT INTELLIGENCE PLATFORM</p>
      <h1>Welcome back</h1><p className="login-subtitle">Sign in to continue to your workspace.</p>
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={(event) => { event.preventDefault(); onSubmit(email, password); }}>
        <label>Email address<input required type="email" autoComplete="username" placeholder="you@company.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Password<input required type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button className="button button-primary full-width" disabled={busy}>{busy ? "Signing in…" : "Sign in"} <ArrowRight size={16} /></button>
      </form>
      <div className="login-foot"><ShieldCheck size={15} />Your workspace is protected</div>
    </div>
  </main>;
}

function AdminOverview({ assessments, questions, results, onNavigate }: { assessments: Assessment[]; questions: Question[]; results: Result[]; onNavigate: (page: string) => void }) {
  const published = assessments.filter((assessment) => assessment.status === "PUBLISHED").length;
  const candidates = new Set(results.map((result) => result.attemptId)).size;
  return <>
    <div className="page-heading"><div><p className="eyebrow">WORKSPACE OVERVIEW</p><h1>Good work starts with good questions.</h1><p>Manage your assessment library, build balanced tests, and review candidate outcomes.</p></div><button className="button button-primary" onClick={() => onNavigate("assessments")}><Plus size={17} />Create assessment</button></div>
    <div className="stats-grid">
      <StatCard label="Question bank" value={questions.length} detail="Active questions" icon={<BookOpen />} />
      <StatCard label="Assessments" value={assessments.length} detail={`${published} published`} icon={<FilePlus2 />} />
      <StatCard label="Completed attempts" value={results.length} detail={`${candidates} candidate results`} icon={<Users />} />
      <StatCard label="Average score" value={results.some((item) => item.maximumScore > 0) ? `${Math.round(results.filter((item) => item.maximumScore > 0).reduce((sum, item) => sum + item.percentage, 0) / results.filter((item) => item.maximumScore > 0).length)}%` : "—"} detail="Across completed technical tests" icon={<BarChart3 />} />
    </div>
    <div className="dashboard-grid">
      <section className="surface-card"><div className="card-heading"><div><h2>Assessments</h2><p>Recently configured assessments</p></div><button className="text-button" onClick={() => onNavigate("assessments")}>View all <ArrowRight size={14} /></button></div>
        <div className="compact-list">{assessments.slice(0, 4).map((assessment) => <div className="compact-row" key={assessment.id}><div className={`type-icon ${assessment.type === "TECHNICAL" ? "blue" : "violet"}`}><FilePlus2 size={17} /></div><div className="compact-main"><strong>{assessment.title}</strong><span>{assessment.type.toLowerCase()} · {assessment.durationMinutes} min</span></div><StatusPill value={assessment.status} /></div>)}
          {!assessments.length && <EmptyState title="No assessments yet" detail="Create your first assessment to get started." />}
        </div>
      </section>
      <section className="surface-card"><div className="card-heading"><div><h2>Recent results</h2><p>Candidate performance snapshots</p></div><button className="text-button" onClick={() => onNavigate("results")}>View all <ArrowRight size={14} /></button></div>
        <div className="compact-list">{results.slice(0, 4).map((item) => <div className="compact-row" key={item.attemptId}><div className="avatar result-avatar">{item.candidate?.name?.[0] || "C"}</div><div className="compact-main"><strong>{item.candidate?.name || item.assessment?.title || "Assessment result"}</strong><span>{item.assessment?.title || `Attempt ${item.attemptId.slice(0, 8)}`}</span></div><strong className="score-value">{Math.round(item.percentage)}%</strong></div>)}
          {!results.length && <EmptyState title="No results yet" detail="Completed candidate assessments will appear here." />}
        </div>
      </section>
    </div>
  </>;
}

function StatCard({ label, value, detail, icon }: { label: string; value: string | number; detail: string; icon: React.ReactNode }) {
  return <article className="stat-card"><div className="stat-top"><span>{label}</span><div className="stat-icon">{icon}</div></div><strong>{value}</strong><small>{detail}</small></article>;
}

function QuestionBank({ questions, categories, query, category, difficulty, status, onQuery, onCategory, onDifficulty, onStatus, onCreate, onEdit, onArchive }: {
  questions: Question[]; categories: Category[]; query: string; category: string; difficulty: string; status: string;
  onQuery: (value: string) => void; onCategory: (value: string) => void; onDifficulty: (value: string) => void; onStatus: (value: string) => void;
  onCreate: () => void; onEdit: (question: Question) => void; onArchive: (question: Question) => void;
}) {
  return <>
    <div className="page-heading"><div><p className="eyebrow">CONTENT LIBRARY</p><h1>Question bank</h1><p>Build and maintain the reusable items that power your assessments.</p></div><button className="button button-primary" onClick={onCreate}><Plus size={17} />Add question</button></div>
    <section className="surface-card table-card">
      <div className="filter-toolbar">
        <label className="search-field"><Search size={17} /><input placeholder="Search questions…" value={query} onChange={(event) => onQuery(event.target.value)} /></label>
        <select value={category} onChange={(event) => onCategory(event.target.value)} aria-label="Filter by category"><option value="">All categories</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select value={difficulty} onChange={(event) => onDifficulty(event.target.value)} aria-label="Filter by difficulty"><option value="">All difficulties</option>{["EASY", "MEDIUM", "HARD", "MIXED"].map((item) => <option key={item}>{item}</option>)}</select>
        <select value={status} onChange={(event) => onStatus(event.target.value)} aria-label="Filter by status"><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option><option value="DRAFT">Draft</option></select>
      </div>
      <div className="table-scroll"><table><thead><tr><th>QUESTION</th><th>CATEGORY</th><th>TYPE</th><th>DIFFICULTY</th><th>STATUS</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{questions.map((question) => <tr key={question.id}><td><strong className="question-cell">{question.text}</strong><span className="table-subtext">{question.topic || "No topic"}{question.skill ? ` · ${question.skill}` : ""}</span></td><td>{question.category.name}</td><td><span className="type-tag">{question.type.replace(/_/g, " ").toLowerCase()}</span></td><td><Difficulty value={question.difficulty} /></td><td><StatusPill value={question.status} /></td><td className="actions-cell"><button className="icon-button" onClick={() => onEdit(question)} aria-label="Edit question"><PenLine size={15} /></button>{question.status !== "ARCHIVED" && <button className="icon-button danger-icon" onClick={() => onArchive(question)} aria-label="Archive question"><Archive size={16} /></button>}</td></tr>)}</tbody>
      </table></div>
      {!questions.length && <EmptyState title="No matching questions" detail="Adjust the filters or add a new question." />}
      <div className="table-footer">Showing {questions.length} question{questions.length === 1 ? "" : "s"} · Up to 100 results</div>
    </section>
  </>;
}

function AssessmentList({ assessments, busy, onCreate, onEdit, onPublish, onUnpublish }: {
  assessments: Assessment[]; busy: boolean; onCreate: () => void; onEdit: (assessment: Assessment) => void;
  onPublish: (assessment: Assessment) => void; onUnpublish: (assessment: Assessment) => void;
}) {
  return <>
    <div className="page-heading"><div><p className="eyebrow">ASSESSMENT BUILDER</p><h1>Assessments</h1><p>Configure sections and quotas, validate your question pool, then publish.</p></div><button className="button button-primary" onClick={onCreate}><Plus size={17} />New assessment</button></div>
    <div className="assessment-grid">{assessments.map((assessment) => {
      const questionTotal = assessment.blueprints?.reduce((sum, row) => sum + row.requiredCount, 0);
      return <article className="assessment-card" key={assessment.id}>
        <div className="assessment-card-top"><div className={`type-icon large ${assessment.type === "TECHNICAL" ? "blue" : "violet"}`}><FilePlus2 size={20} /></div><StatusPill value={assessment.status} /></div>
        <h2>{assessment.title}</h2><p className="assessment-description">{assessment.description || "No description provided."}</p>
        <div className="assessment-meta"><span><Clock3 size={15} />{assessment.durationMinutes} minutes</span><span><BookOpen size={15} />{questionTotal ?? assessment.sections.length} questions</span><span><Users size={15} />{assessment._count?.attempts ?? 0} attempts</span></div>
        {assessment.blueprints?.length ? <div className="quota-list">{assessment.blueprints.slice(0, 4).map((row) => <div className="quota-row" key={row.id}><span>{row.section.title} · {row.category.name} · {row.difficulty.toLowerCase()}</span><strong className={row.short ? "shortage" : ""}>{row.availableCount ?? "—"} / {row.requiredCount}</strong></div>)}{assessment.blueprints.length > 4 && <small>+{assessment.blueprints.length - 4} more blueprint rows</small>}</div> : null}
        <div className="assessment-card-footer"><span className={`assessment-type-label ${assessment.type === "TECHNICAL" ? "blue-text" : "violet-text"}`}>{assessment.type.toLowerCase()}</span><div className="assessment-actions">
          {assessment.status === "DRAFT" && <><button className="button button-small button-light" disabled={busy} onClick={() => onEdit(assessment)}>Edit draft</button><button className="button button-small button-primary" disabled={busy} onClick={() => onPublish(assessment)}>Validate & publish <ArrowRight size={14} /></button></>}
          {assessment.status === "PUBLISHED" && assessment._count?.attempts === 0 && <button className="button button-small button-light" disabled={busy} onClick={() => onUnpublish(assessment)}>Unpublish</button>}
        </div></div>
      </article>;
    })}</div>
    {!assessments.length && <div className="surface-card"><EmptyState title="No assessments yet" detail="Create a draft and add blueprint quotas to start." /></div>}
  </>;
}

function CandidateDashboard({ assessments, busy, onStart }: { assessments: Assessment[]; busy: boolean; onStart: (assessment: Assessment) => void }) {
  return <>
    <div className="page-heading"><div><p className="eyebrow">CANDIDATE WORKSPACE</p><h1>Your assessments</h1><p>Take an assessment in one sitting. Your answers are saved as you go.</p></div></div>
    <div className="candidate-welcome"><div className="welcome-icon"><ShieldCheck size={22} /></div><div><strong>Before you begin</strong><p>Find a quiet space and allow enough time. Your timer starts when you begin, and you can review answers before submitting.</p></div></div>
    <div className="assessment-grid candidate-assessment-grid">{assessments.map((assessment) => <article className="assessment-card" key={assessment.id}><div className="assessment-card-top"><div className={`type-icon large ${assessment.type === "TECHNICAL" ? "blue" : "violet"}`}><BookOpen size={20} /></div><span className="status-pill status-published">Available</span></div><h2>{assessment.title}</h2><p className="assessment-description">{assessment.description || "Assessment prepared for you."}</p><div className="assessment-meta"><span><Clock3 size={15} />{assessment.durationMinutes} minutes</span><span><BookOpen size={15} />{assessment.sections.length} sections</span></div><button className="button button-primary full-width" disabled={busy} onClick={() => onStart(assessment)}>View instructions <ArrowRight size={16} /></button></article>)}</div>
    {!assessments.length && <div className="surface-card"><EmptyState title="Nothing assigned yet" detail="Published assessments will appear here when they are ready." /></div>}
  </>;
}

function InstructionDialog({ assessment, busy, onClose, onStart }: {
  assessment: Assessment; busy: boolean; onClose: () => void; onStart: () => void;
}) {
  return <Modal title="Assessment instructions" onClose={onClose}>
    <div className="instruction-content">
      <p className="eyebrow">{assessment.type} ASSESSMENT</p>
      <h3>{assessment.title}</h3>
      <p>{assessment.description || "Read the instructions before beginning your assessment."}</p>
      <div className="instruction-summary"><span><Clock3 size={16} />{assessment.durationMinutes} minutes</span><span><BookOpen size={16} />{assessment.sections.length} sections</span></div>
      <strong>Before you start</strong>
      <ul><li>Your timer begins when you start and the attempt should be completed in one sitting.</li><li>Answers are saved as you go. Refreshing the page will resume this same attempt.</li><li>You can flag questions and review unanswered items before submitting.</li><li>At time expiry, your saved responses are submitted automatically.</li></ul>
      <div className="modal-actions"><button className="button button-light" onClick={onClose}>Not yet</button><button className="button button-primary" disabled={busy} onClick={onStart}>{busy ? "Starting…" : "Start timed assessment"} <ArrowRight size={15} /></button></div>
    </div>
  </Modal>;
}

function ResultsList({ results, onOpen }: { results: Result[]; onOpen: (result: Result) => void }) {
  return <>
    <div className="page-heading"><div><p className="eyebrow">CANDIDATE OUTCOMES</p><h1>Results</h1><p>Review completed attempts and section performance.</p></div></div>
    <section className="surface-card table-card"><div className="table-scroll"><table><thead><tr><th>ASSESSMENT</th><th>ATTEMPT</th><th>SECTION SCORES</th><th>SCORE</th><th>COMPLETED</th><th></th></tr></thead><tbody>
      {results.map((result) => <tr key={result.attemptId}><td><strong>{result.assessment?.title || "Assessment"}</strong><span className="table-subtext">{result.candidate?.name || "Candidate"}</span></td><td>{result.attemptId.slice(0, 12)}</td><td>{result.sectionScores.map((section) => `${section.sectionTitle}: ${section.score}/${section.maximumScore}`).join(" · ") || result.dimensionScores.map((dimension) => dimension.name).join(", ") || "—"}</td><td><strong>{result.maximumScore > 0 ? `${Math.round(result.percentage)}%` : "Illustrative"}</strong></td><td>{new Date(result.calculatedAt).toLocaleDateString()}</td><td><button className="text-button" onClick={() => onOpen(result)}>View <ArrowRight size={13} /></button></td></tr>)}
    </tbody></table></div>{!results.length && <EmptyState title="No completed attempts" detail="Results appear here after candidates submit their assessments." />}</section>
  </>;
}

function ResultView({ result, candidate, onBack }: { result: Result; candidate?: boolean; onBack?: () => void }) {
  return <><div className="page-heading"><div><p className="eyebrow">ASSESSMENT COMPLETE</p><h1>Your result summary</h1><p>Review your section results and competency profile.</p></div>{onBack && <button className="button button-light" onClick={onBack}>Back to assessments <ArrowLeft size={16} /></button>}</div>
    <section className="result-hero"><div><span className="eyebrow">{result.maximumScore > 0 ? "OVERALL SCORE" : "ASSESSMENT PROFILE"}</span><strong>{result.maximumScore > 0 ? <>{Math.round(result.percentage)}<small>%</small></> : "Illustrative"}</strong><p>{result.maximumScore > 0 ? `${result.technicalScore} of ${result.maximumScore} available marks` : "Dimension summaries are shown below"}</p></div>{result.maximumScore > 0 && <div className="result-circle"><span>{Math.round(result.percentage)}%</span><small>Overall</small></div>}</section>
    {result.sectionScores.length > 0 && <section className="surface-card result-card"><div className="card-heading"><div><h2>Section totals</h2><p>Auto-scored objective responses</p></div></div><div className="section-score-list">{result.sectionScores.map((section) => <div className="section-score-row" key={section.sectionId || section.sectionTitle}><div><strong>{section.sectionTitle}</strong><span>{section.score} / {section.maximumScore} marks</span></div><div className="score-track"><i style={{ width: `${section.maximumScore ? Math.max(0, Math.min(100, (section.score / section.maximumScore) * 100)) : 0}%` }} /></div></div>)}</div></section>}
    {result.dimensionScores.length > 0 && <section className="surface-card result-card"><div className="card-heading"><div><h2>Competency profile</h2><p>Dimension summaries are for reflection</p></div><span className="illustrative-tag">ILLUSTRATIVE</span></div><p className="notice-text">{result.illustrativeNotice}</p><div className="dimension-grid">{result.dimensionScores.map((dimension) => <div className="dimension-row" key={dimension.id || dimension.name}><div><strong>{dimension.name}</strong><span>{dimension.score.toFixed(1)} / 5</span></div><div className="score-track"><i style={{ width: `${Math.min(100, Math.max(0, dimension.score * 20))}%` }} /></div></div>)}</div></section>}
    {candidate && <div className="completion-note"><Check size={17} />Your response has been submitted and your score is saved.</div>}
  </>;
}

function AnswerControl({ question, onAnswer }: { question: AttemptQuestion; onAnswer: (answer: string | string[] | number) => void }) {
  const isMulti = question.questionType === "MULTIPLE_CHOICE";
  if (question.questionType === "LIKERT") {
    const points = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];
    return <div className="likert-options">{points.map((label, index) => <button key={label} onClick={() => onAnswer(index + 1)} className={`answer-option likert-option ${question.answer === index + 1 ? "selected" : ""}`}><span className="likert-point">{index + 1}</span><span>{label}</span></button>)}</div>;
  }
  return <div className="answer-options">{question.options.map((option) => {
    const selected = isMulti ? Array.isArray(question.answer) && question.answer.includes(option.id)
      : question.answer === option.id;
    return <button key={option.id} className={`answer-option ${selected ? "selected" : ""}`} onClick={() => {
      if (isMulti) {
        const answers = Array.isArray(question.answer) ? question.answer as string[] : [];
        onAnswer(selected ? answers.filter((id) => id !== option.id) : [...answers, option.id]);
      } else onAnswer(option.id);
    }}><span className={`selection-indicator ${isMulti ? "checkbox" : ""}`}>{selected && <Check size={13} />}</span><span>{option.text}</span></button>;
  })}</div>;
}

function ReviewDialog({ attempt, busy, onClose, onSubmit, onQuestion }: {
  attempt: Attempt; busy: boolean; onClose: () => void; onSubmit: () => void; onQuestion: (index: number) => void;
}) {
  const unanswered = attempt.questions.filter((question) => question.answer === null).length;
  return <div className="modal-backdrop" role="presentation"><section className="review-dialog" role="dialog" aria-modal="true" aria-labelledby="review-title"><button className="modal-close" onClick={onClose} aria-label="Close review"><X size={18} /></button><div className="modal-icon"><ShieldCheck size={21} /></div><p className="eyebrow">FINAL REVIEW</p><h2 id="review-title">Ready to submit?</h2><p className="review-copy">You have <strong>{unanswered} unanswered {unanswered === 1 ? "question" : "questions"}</strong>. You can return to any question before submitting.</p><div className="review-question-list">{attempt.questions.map((question, index) => <button key={question.id} className="review-question" onClick={() => onQuestion(index)}><span className={`review-status ${question.answer !== null ? "done" : ""}`}>{question.answer !== null ? <Check size={13} /> : index + 1}</span><span>Question {index + 1}</span><span>{question.answer !== null ? "Answered" : "Unanswered"}</span><ArrowRight size={14} /></button>)}</div><div className="review-actions"><button className="button button-light" onClick={onClose}>Continue assessment</button><button className="button button-primary" disabled={busy} onClick={onSubmit}>{busy ? "Submitting…" : "Submit assessment"} <ArrowRight size={15} /></button></div></section></div>;
}

function QuestionModal({ form, setForm, categories, dimensions, editing, busy, onClose, onSubmit }: {
  form: QuestionForm; setForm: (form: QuestionForm) => void; categories: Category[]; dimensions: Dimension[];
  editing: boolean; busy: boolean; onClose: () => void; onSubmit: (event: React.FormEvent) => void;
}) {
  const psychometric = form.type === "LIKERT" || form.type === "SITUATIONAL_JUDGMENT";
  const multi = form.type === "MULTIPLE_CHOICE" || form.type === "SQL";
  const changeOption = (index: number, patch: Partial<Option>) => setForm({ ...form, options: form.options.map((option, row) => row === index ? { ...option, ...patch } : option) });
  function changeType(type: string) {
    const options = type === "LIKERT" ? [] : type === "SITUATIONAL_JUDGMENT"
      ? [{ text: "", scoreValue: 1 }, { text: "", scoreValue: 3 }, { text: "", scoreValue: 5 }]
      : [{ text: "", isCorrect: true }, { text: "", isCorrect: false }];
    setForm({ ...form, type, options, marks: ["LIKERT", "SITUATIONAL_JUDGMENT"].includes(type) ? 0 : 1 });
  }
  return <Modal title={editing ? "Edit question" : "Add a question"} onClose={onClose} wide>
    <form className="form-grid" onSubmit={onSubmit}>
      <label className="span-two">Question text<textarea required minLength={5} rows={3} value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} placeholder="Write a clear, focused question…" /></label>
      <label>Question type<select value={form.type} onChange={(event) => changeType(event.target.value)}><option value="SINGLE_CHOICE">Single choice</option><option value="MULTIPLE_CHOICE">Multiple answer</option><option value="SQL">SQL knowledge</option><option value="LIKERT">Likert scale</option><option value="SITUATIONAL_JUDGMENT">Situational judgment</option></select></label>
      <label>Category<select required value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}><option value="">Select category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label>Difficulty<select value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: event.target.value })}>{["EASY", "MEDIUM", "HARD", "MIXED"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Topic<input value={form.topic} onChange={(event) => setForm({ ...form, topic: event.target.value })} placeholder="e.g. Joins" /></label>
      <label>Skill<input value={form.skill} onChange={(event) => setForm({ ...form, skill: event.target.value })} placeholder="e.g. Query design" /></label>
      {!psychometric && <><label>Marks<input type="number" min="0" step="0.5" value={form.marks} onChange={(event) => setForm({ ...form, marks: Number(event.target.value) })} /></label><label>Negative marks<input type="number" min="0" step="0.25" value={form.negativeMarks} onChange={(event) => setForm({ ...form, negativeMarks: Number(event.target.value) })} /></label></>}
      {form.type !== "LIKERT" && <div className="span-two options-editor"><div className="form-section-heading"><div><strong>Answer options</strong><span>{psychometric ? "Score each response from 1 to 5" : "Mark the correct answer"}</span></div><button type="button" className="text-button" onClick={() => setForm({ ...form, options: [...form.options, { text: "", isCorrect: false, ...(psychometric ? { scoreValue: 3 } : {}) }] })}><Plus size={14} />Add option</button></div>
        {form.options.map((option, index) => <div className="option-editor-row" key={index}><span className="option-number">{index + 1}</span><input required value={option.text} onChange={(event) => changeOption(index, { text: event.target.value })} placeholder={`Option ${index + 1}`} />
          {psychometric ? <select aria-label="Option score" value={option.scoreValue || 3} onChange={(event) => changeOption(index, { scoreValue: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>Score {score}</option>)}</select>
            : <label className="correct-check"><input type={multi ? "checkbox" : "radio"} name="correct-option" checked={!!option.isCorrect} onChange={(event) => {
              if (multi) changeOption(index, { isCorrect: event.target.checked });
              else if (event.target.checked) setForm({ ...form, options: form.options.map((item, row) => ({ ...item, isCorrect: row === index })) });
            }} />Correct</label>}
          <button type="button" className="icon-button" disabled={form.options.length <= 2} onClick={() => setForm({ ...form, options: form.options.filter((_, row) => row !== index) })} aria-label="Remove option"><X size={15} /></button>
        </div>)}
      </div>}
      {psychometric && <div className="span-two options-editor">
        <div className="form-section-heading"><div><strong>Scoring dimensions</strong><span>Dimension summaries are illustrative, not diagnostic.</span></div><button type="button" className="text-button" onClick={() => setForm({ ...form, dimensions: [...form.dimensions, { dimensionId: "", weight: 1, reverseScored: false }] })}><Plus size={14} />Add dimension</button></div>
        {form.dimensions.map((mapping, index) => <div className="dimension-editor-row" key={index}>
          <select required value={mapping.dimensionId} onChange={(event) => setForm({ ...form, dimensions: form.dimensions.map((item, row) => row === index ? { ...item, dimensionId: event.target.value } : item) })}><option value="">Select dimension</option>{dimensions.map((dimension) => <option key={dimension.id} value={dimension.id}>{dimension.name}</option>)}</select>
          <label className="weight-field">Weight<input type="number" min="0.1" max="100" step="0.1" value={mapping.weight} onChange={(event) => setForm({ ...form, dimensions: form.dimensions.map((item, row) => row === index ? { ...item, weight: Number(event.target.value) } : item) })} /></label>
          <label className="correct-check"><input type="checkbox" checked={mapping.reverseScored} onChange={(event) => setForm({ ...form, dimensions: form.dimensions.map((item, row) => row === index ? { ...item, reverseScored: event.target.checked } : item) })} />Reverse score</label>
          <button type="button" className="icon-button" disabled={form.dimensions.length <= 1} onClick={() => setForm({ ...form, dimensions: form.dimensions.filter((_, row) => row !== index) })} aria-label="Remove dimension"><X size={15} /></button>
        </div>)}
      </div>}
      <div className="modal-actions span-two"><button type="button" className="button button-light" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add question"} <Check size={15} /></button></div>
    </form>
  </Modal>;
}

function AssessmentModal({ form, setForm, categories, busy, editing, onClose, onSubmit }: {
  form: AssessmentForm; setForm: (form: AssessmentForm) => void; categories: Category[]; busy: boolean;
  editing: boolean; onClose: () => void; onSubmit: (event: React.FormEvent) => void;
}) {
  return <Modal title={editing ? "Edit draft assessment" : "Create assessment"} onClose={onClose}>
    <form className="form-grid" onSubmit={onSubmit}>
      <label className="span-two">Assessment name<input required minLength={3} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Data Analyst Assessment" /></label>
      <label className="span-two">Description<textarea rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
      <label>Assessment type<select disabled={editing} value={form.type} onChange={(event) => setForm({
        ...form,
        type: event.target.value,
        sections: event.target.value === "PSYCHOMETRIC"
          ? form.sections.map((section) => ({ ...section, quotas: section.quotas.map((quota) => ({ ...quota, difficulty: "MIXED" })) }))
          : form.sections
      })}><option value="TECHNICAL">Technical</option><option value="PSYCHOMETRIC">Psychometric</option></select></label>
      <label>Duration (minutes)<input required type="number" min={1} max={300} value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: Number(event.target.value) })} /></label>
      {form.type === "TECHNICAL" && <label className="toggle-label"><input type="checkbox" checked={form.negativeMarking} onChange={(event) => setForm({ ...form, negativeMarking: event.target.checked })} />Enable negative marking</label>}
      <div className="span-two sections-editor">
        <div className="form-section-heading"><div><strong>Sections and blueprint quotas</strong><span>Each quota draws active questions from one category and difficulty pool.</span></div>
          {!editing && <button type="button" className="text-button" onClick={() => setForm({ ...form, sections: [...form.sections, { title: `Section ${form.sections.length + 1}`, quotas: [{ categoryId: categories[0]?.id || "", difficulty: "EASY", requiredCount: 1 }] }] })}><Plus size={14} />Add section</button>}
        </div>
        {form.sections.map((section, sectionIndex) => <div className="section-editor" key={sectionIndex}>
          <div className="section-editor-head"><label>Section name<input required disabled={editing} value={section.title} onChange={(event) => setForm({ ...form, sections: form.sections.map((item, index) => index === sectionIndex ? { ...item, title: event.target.value } : item) })} /></label>
            {!editing && <button type="button" className="icon-button" disabled={form.sections.length <= 1} onClick={() => setForm({ ...form, sections: form.sections.filter((_, index) => index !== sectionIndex) })} aria-label="Remove section"><X size={15} /></button>}
          </div>
          {section.quotas.map((quota, quotaIndex) => <div className="quota-editor-row" key={quotaIndex}>
            <select required aria-label="Quota category" value={quota.categoryId} onChange={(event) => setForm({ ...form, sections: form.sections.map((item, index) => index === sectionIndex ? { ...item, quotas: item.quotas.map((row, rowIndex) => rowIndex === quotaIndex ? { ...row, categoryId: event.target.value } : row) } : item) })}><option value="">Category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
            <select aria-label="Quota difficulty" value={quota.difficulty} onChange={(event) => setForm({ ...form, sections: form.sections.map((item, index) => index === sectionIndex ? { ...item, quotas: item.quotas.map((row, rowIndex) => rowIndex === quotaIndex ? { ...row, difficulty: event.target.value } : row) } : item) })}>{["EASY", "MEDIUM", "HARD", "MIXED"].map((value) => <option key={value}>{value}</option>)}</select>
            <label>Required<input required type="number" min={1} max={100} value={quota.requiredCount} onChange={(event) => setForm({ ...form, sections: form.sections.map((item, index) => index === sectionIndex ? { ...item, quotas: item.quotas.map((row, rowIndex) => rowIndex === quotaIndex ? { ...row, requiredCount: Number(event.target.value) } : row) } : item) })} /></label>
            <button type="button" className="icon-button" disabled={section.quotas.length <= 1} onClick={() => setForm({ ...form, sections: form.sections.map((item, index) => index === sectionIndex ? { ...item, quotas: item.quotas.filter((_, rowIndex) => rowIndex !== quotaIndex) } : item) })} aria-label="Remove quota"><X size={15} /></button>
          </div>)}
          <button type="button" className="text-button add-quota" onClick={() => setForm({ ...form, sections: form.sections.map((item, index) => index === sectionIndex ? { ...item, quotas: [...item.quotas, { categoryId: categories[0]?.id || "", difficulty: "EASY", requiredCount: 1 }] } : item) })}><Plus size={13} />Add quota row</button>
        </div>)}
      </div>
      <p className="form-helper span-two">The publish check reports shortages by section, category, and difficulty. You can adjust draft quotas before publishing.</p>
      <div className="modal-actions span-two"><button type="button" className="button button-light" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save draft" : "Create draft"} <ArrowRight size={15} /></button></div>
    </form>
  </Modal>;
}

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true"><div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div>{children}</section></div>;
}

function ConfirmDialog({ title, description, busy, onCancel, onConfirm }: { title: string; description: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop"><section className="confirm-dialog" role="dialog" aria-modal="true"><div className="modal-icon warning-icon"><Archive size={20} /></div><h2>{title}</h2><p>{description}</p><div className="modal-actions"><button className="button button-light" onClick={onCancel}>Cancel</button><button className="button button-danger" disabled={busy} onClick={onConfirm}>{busy ? "Archiving…" : "Archive question"}</button></div></section></div>;
}

function StatusPill({ value }: { value: string }) {
  return <span className={`status-pill status-${value.toLowerCase()}`}>{value.toLowerCase()}</span>;
}

function Difficulty({ value }: { value: string }) {
  return <span className={`difficulty difficulty-${value.toLowerCase()}`}><i />{value.toLowerCase()}</span>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><div><BookOpen size={20} /></div><strong>{title}</strong><p>{detail}</p></div>;
}

function Toast({ message, onClose, tone }: { message: string; onClose: () => void; tone?: "error" }) {
  return <div className={`toast ${tone === "error" ? "toast-error" : ""}`} role="status">{tone !== "error" && <Check size={17} />}{message}<button className="icon-button" onClick={onClose} aria-label="Dismiss"><X size={16} /></button></div>;
}
