import { Image } from 'expo-image';
import { useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner, Button, Card, Field, Heading, LinkButton, usePalette, type TextInputHandle } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { loginStep, type Step } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { useSession } from '@/lib/session';

// The same steps as the website's login (app/login/LoginFlow.tsx); every rule is checked on the server.
type Screen = Exclude<Step, { step: 'error' } | { step: 'loggedIn' }> | { step: 'phone' } | { step: 'verifyEmail' };

const digits = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

export default function Login() {
  const { signIn } = useSession();
  const c = usePalette();
  const [screen, setScreen] = useState<Screen>({ step: 'phone' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Typed values, kept so "Send a new code" can resend without retyping.
  const [cell, setCell] = useState('');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [email, setEmail] = useState('');
  const [purpose, setPurpose] = useState<'' | 'family' | 'staff' | 'other'>('');
  const [staffRole, setStaffRole] = useState('');
  const [teamText, setTeamText] = useState('');
  const [notes, setNotes] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const pinRef = useRef<TextInputHandle>(null);

  async function go(action: string, fields: Record<string, string | null>, opts: { resent?: boolean } = {}) {
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    const s = await loginStep(action, fields);
    setBusy(false);
    if (s.step === 'loggedIn') {
      haptic.success();
      await signIn(s.token);
      return;
    }
    if (s.step === 'error') {
      haptic.error();
      setError(s.message);
      if (screen.step === 'pin') {
        setPin('');
        pinRef.current?.focus();
      }
      return;
    }
    if (s.step !== screen.step) setCode('');
    // Fresh PIN boxes on screens that ask for a new PIN. (Signup keeps them for "Send a new code".)
    if ((s.step === 'starterCode' || s.step === 'resetCode') && s.step !== screen.step) {
      setPin1('');
      setPin2('');
    }
    if (s.step === 'pin') setPin('');
    if (opts.resent) {
      haptic.success();
      setNotice('A new code is on its way.');
    }
    setScreen(s);
  }

  function restart() {
    setScreen({ step: 'phone' });
    setError(null);
    setNotice(null);
    setPin('');
    setCode('');
    setPin1('');
    setPin2('');
  }

  const signupFields = {
    cell,
    firstName: first,
    lastName: last,
    email,
    pin1,
    pin2,
    purpose,
    staffRole: purpose === 'staff' ? staffRole : null,
    teamText: purpose === 'staff' ? teamText : null,
    notes: purpose === 'other' ? notes : null,
  };
  const codeField = (
    <Field
      label="6-digit code"
      spaced
      keyboardType="number-pad"
      textContentType="oneTimeCode"
      autoComplete="one-time-code"
      maxLength={6}
      value={code}
      onChangeText={(v) => setCode(digits(v, 6))}
      autoFocus
    />
  );
  const pinField = (label: string, value: string, set: (v: string) => void, autoFocus = false) => (
    <Field
      label={label}
      spaced
      secureTextEntry
      keyboardType="number-pad"
      textContentType="newPassword"
      maxLength={4}
      value={value}
      onChangeText={(v) => set(digits(v, 4))}
      autoFocus={autoFocus}
    />
  );
  const newPinFields = (
    <>
      {pinField('New 4-digit PIN', pin1, setPin1)}
      {pinField('Type it again', pin2, setPin2)}
    </>
  );
  const resend = (action: string, fields: Record<string, string | null>) => (
    <LinkButton title="Send a new code" disabled={busy} onPress={() => go(action, fields, { resent: true })} />
  );
  const emailField = (
    <Field
      label="Email"
      keyboardType="email-address"
      textContentType="emailAddress"
      autoComplete="email"
      autoCapitalize="none"
      autoCorrect={false}
      value={email}
      onChangeText={setEmail}
      autoFocus
    />
  );

  let body: ReactNode;
  switch (screen.step) {
    case 'phone':
      body = (
        <Panel title="Log in">
          <Field
            label="Cell phone number"
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            placeholder="(423) 555-1234"
            value={cell}
            onChangeText={(v) => {
              setCell(v);
              // Goes on by itself at the 10th digit. Area codes never start with 1, so a leading 1 (+1) waits for one more.
              const d = v.replace(/\D/g, '');
              if (d.length === (d.startsWith('1') ? 11 : 10)) go('lookupPhone', { cell: v });
            }}
            autoFocus
          />
          {busy && <Text style={[styles.center, { color: c.textSecondary }]}>Checking…</Text>}
        </Panel>
      );
      break;

    case 'pin':
      body = (
        <Panel title="Enter your PIN">
          <Field
            ref={pinRef}
            label="4-digit PIN"
            spaced
            secureTextEntry
            keyboardType="number-pad"
            textContentType="password"
            maxLength={4}
            value={pin}
            onChangeText={(v) => {
              const p = digits(v, 4);
              setPin(p);
              if (p.length === 4) go('submitPin', { cell, pin: p });
            }}
            autoFocus
          />
          <Button title="Log in" busy={busy} onPress={() => go('submitPin', { cell, pin })} />
          <LinkButton title="Forgot PIN?" disabled={busy} onPress={() => go('startForgot', { cell })} />
        </Panel>
      );
      break;

    case 'create':
      body = (
        <Panel title="Create account" intro="We don't have that number yet. Fill this in and we'll email you a code.">
          <Field label="First name" textContentType="givenName" autoComplete="given-name" value={first} onChangeText={setFirst} autoFocus />
          <Field label="Last name" textContentType="familyName" autoComplete="family-name" value={last} onChangeText={setLast} />
          <Field
            label="Email"
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect={false}
            value={email}
            onChangeText={setEmail}
          />
          {pinField('Choose a 4-digit PIN', pin1, setPin1)}
          {pinField('Type it again', pin2, setPin2)}
          <Text style={[styles.question, { color: c.text }]}>What brings you to Thunder?</Text>
          {(
            [
              ['family', 'New family'],
              ['staff', 'New team staff'],
              ['other', 'Other'],
            ] as const
          ).map(([k, label]) => (
            <LinkButton key={k} title={`${purpose === k ? '● ' : '○ '}${label}`} onPress={() => setPurpose(k)} />
          ))}
          {purpose === 'family' && (
            <Text style={{ color: c.textSecondary }}>Your account is ready right away. We find your players from registration by your cell number.</Text>
          )}
          {purpose === 'staff' && (
            <>
              {(
                [
                  ['HeadCoach', 'Head Coach'],
                  ['AsstCoach', 'Asst Coach'],
                  ['Manager', 'Team Manager'],
                  ['TeamParent', 'Team Parent'],
                ] as const
              ).map(([k, label]) => (
                <LinkButton key={k} title={`${staffRole === k ? '● ' : '○ '}${label}`} onPress={() => setStaffRole(k)} />
              ))}
              <Field label="Team name (as Thunder lists it) or coach" value={teamText} onChangeText={setTeamText} />
            </>
          )}
          {purpose === 'other' && <Field label="Tell us why you're joining" value={notes} onChangeText={setNotes} multiline />}
          <Button title="Email me a code" busy={busy} onPress={() => go('startSignup', signupFields)} />
        </Panel>
      );
      break;

    case 'signupCode':
      body = (
        <Panel title="Check your email" intro={`We sent a code to ${screen.maskedEmail}.`}>
          {codeField}
          <Button title="Create account" busy={busy} onPress={() => go('completeSignup', { cell, code })} />
          {resend('startSignup', signupFields)}
        </Panel>
      );
      break;

    case 'starterEmail':
      body = (
        <Panel title="Add your email" intro="To set your PIN, we'll email you a code. Where should we send it?">
          {emailField}
          <Button title="Email me a code" busy={busy} onPress={() => go('sendStarterCode', { cell, email })} />
        </Panel>
      );
      break;

    case 'starterCode':
      body = (
        <Panel title="Set your PIN" intro={`We sent a code to ${screen.maskedEmail}. Enter it and choose your PIN.`}>
          {codeField}
          {newPinFields}
          <Button title="Set PIN" busy={busy} onPress={() => go('completeStarter', { cell, code, pin1, pin2 })} />
          {resend('sendStarterCode', { cell, email: email || null })}
        </Panel>
      );
      break;

    case 'verifyChoice':
      body = (
        <Panel title="Verify your email" intro="Before you log in, we need to confirm your email address.">
          {screen.maskedEmail && (
            <Button
              title={`Email a code to ${screen.maskedEmail}`}
              busy={busy}
              onPress={() => go('sendVerifyCode', { cell, pin, email: null })}
            />
          )}
          {screen.maskedEmail ? (
            <LinkButton title="Use a different email" disabled={busy} onPress={() => setScreen({ step: 'verifyEmail' })} />
          ) : (
            <Button title="Add your email" disabled={busy} onPress={() => setScreen({ step: 'verifyEmail' })} />
          )}
        </Panel>
      );
      break;

    case 'verifyEmail':
      body = (
        <Panel title="Your email">
          {emailField}
          <Button title="Email me a code" busy={busy} onPress={() => go('sendVerifyCode', { cell, pin, email })} />
        </Panel>
      );
      break;

    case 'verifyCode':
      body = (
        <Panel title="Check your email" intro={`We sent a code to ${screen.maskedEmail}.`}>
          {codeField}
          <Button title="Verify and log in" busy={busy} onPress={() => go('completeVerify', { cell, pin, code })} />
          {resend('sendVerifyCode', { cell, pin, email: email || null })}
        </Panel>
      );
      break;

    case 'resetCode':
      body = (
        <Panel title="Reset your PIN" intro={`We sent a code to ${screen.maskedEmail}. Enter it and choose a new PIN.`}>
          {codeField}
          {newPinFields}
          <Button title="Save PIN" busy={busy} onPress={() => go('completeReset', { cell, code, pin1, pin2 })} />
          {resend('startForgot', { cell })}
        </Panel>
      );
      break;

    case 'devCode':
      body = (
        <Panel title="Enter code" intro="Testing mode: the code is 123456.">
          {codeField}
          <Button title="Log in" busy={busy} onPress={() => go('devLogin', { cell, code })} />
        </Panel>
      );
      break;

    case 'done':
      body = <Panel title="Thunder Basketball" intro={screen.message} />;
      break;
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.background }]}>
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Image source={require('@/assets/images/logo.png')} style={styles.logo} contentFit="contain" />
            <Text style={[styles.title, { color: c.text }]}>Thunder Basketball</Text>
          </View>
          {error && <Banner kind="error" text={error} />}
          {notice && !error && <Banner kind="notice" text={notice} />}
          <Card>{body}</Card>
          {screen.step !== 'phone' && <LinkButton title="← Use a different number" onPress={restart} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Panel({ title, intro, children }: { title: string; intro?: string; children?: ReactNode }) {
  return (
    <>
      <Heading title={title} intro={intro} />
      {children}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  inner: { padding: Spacing.three, paddingTop: Spacing.five, gap: Spacing.three },
  brand: { alignItems: 'center', gap: Spacing.three, marginBottom: Spacing.three },
  logo: { width: 112, height: 112 },
  title: { fontSize: 24, fontWeight: '600', letterSpacing: -0.3 },
  center: { textAlign: 'center' },
  question: { fontSize: 15, fontWeight: '600' },
});
