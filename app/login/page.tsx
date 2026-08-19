import motion from "@/shared/ui/motion.module.css";
import styles from "./page.module.css";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className={`${styles.main} ${motion.pageEnter}`}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>RiverLine SDD</p>
        <h1 className={styles.heading}>Sign in</h1>
        <p className={styles.subhead}>
          Enter the email address on file with your jurisdiction. We&apos;ll send a
          one-time sign-in link. No password required.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
