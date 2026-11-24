import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Communication } from "@/request/communication";

import {
  clearCreationSubmission,
  sendCreationSubmission,
} from "./creation-submission";
import type { CreationRecovery } from "./creation-submission";

/** 恢复已经发出的新建请求。发送时沿用原提交 ID 和请求内容。 */
export function CommunicationCreationRecovery({
  accountId,
  recovery,
  onRecovered,
  onReturn,
}: {
  accountId: string;
  recovery: CreationRecovery;
  onRecovered: (communication: Communication) => Promise<void>;
  onReturn: () => void;
}) {
  const router = useRouter();
  const { submission } = recovery;
  const [attempt, setAttempt] = useState(recovery.attempt);
  const [error, setError] = useState(recovery.message ?? "");
  const [completionTitle, setCompletionTitle] = useState("");
  const ended = useRef(false);

  useEffect(() => {
    if (!attempt) return;
    let active = true;
    const unsubscribe = router.history.subscribe(() => {
      active = false;
    });

    void attempt.then(async (result) => {
      if (!active || ended.current) return;

      if (result.status === "ended") {
        onReturn();
        return;
      }
      if (result.status === "saved") {
        ended.current = true;
        try {
          await onRecovered(result.communication);
        } catch {
          if (!active) return;
          setCompletionTitle("沟通记录已保存");
          setError("沟通记录已保存，请返回列表查看。");
          setAttempt(undefined);
        }
        return;
      }

      setAttempt(undefined);
      if (result.status === "rejected") {
        setCompletionTitle("本次提交未保存");
        setError(result.error.message);
      } else {
        setError(result.message);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [attempt, onRecovered, onReturn, router]);

  function retry() {
    if (ended.current || attempt) return;
    setError("");
    setAttempt(sendCreationSubmission(accountId, submission));
  }

  function end() {
    if (ended.current) return;
    try {
      clearCreationSubmission(submission);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "无法结束本地确认。"
      );
      return;
    }
    ended.current = true;
    onReturn();
  }

  return (
    <main className="flex-1 space-y-5 bg-background px-5 py-6 sm:px-7 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {completionTitle || "有一笔提交待确认"}
          </h1>
          {!completionTitle && (
            <p className="text-sm text-muted-foreground">
              重试会发送原提交。保存成功后将打开对应的沟通记录。
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={onReturn}>
            返回沟通列表
          </Button>
          {!completionTitle && (
            <>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="outline">
                    结束本次确认
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="w-[calc(100%-2rem)]">
                  <AlertDialogHeader>
                    <AlertDialogTitle>结束本次确认？</AlertDialogTitle>
                    <AlertDialogDescription>
                      原请求可能已经保存。结束后此页面将停止确认，你可以先在沟通列表查看保存结果。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>继续确认</AlertDialogCancel>
                    <AlertDialogAction onClick={end}>
                      确认结束
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button
                type="button"
                aria-busy={Boolean(attempt)}
                disabled={Boolean(attempt)}
                onClick={retry}
              >
                {attempt ? "正在重试…" : "重试原提交"}
              </Button>
            </>
          )}
        </div>
      </header>

      {error && <FieldError>{error}</FieldError>}

      <Field>
        <FieldLabel htmlFor="creation-recovery-title">主题</FieldLabel>
        <Input
          id="creation-recovery-title"
          value={submission.input.title}
          readOnly
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="creation-recovery-summary">
          初次沟通内容
        </FieldLabel>
        <Textarea
          id="creation-recovery-summary"
          className="min-h-36"
          value={submission.input.summary}
          readOnly
        />
      </Field>
    </main>
  );
}
