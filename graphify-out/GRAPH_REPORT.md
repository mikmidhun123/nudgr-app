# Graph Report - App -V2  (2026-11-17)

## Corpus Check
- 205 files · ~375,570 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 47 file(s) not represented in the graph (top: .xml 21, (none) 8, .bat 7)

## Summary
- 1706 nodes · 3299 edges · 128 communities (84 shown, 44 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 73 edges (avg confidence: 0.91)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `04f9d3da`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- localNotifications.js
- Patterns
- sendNudgeOnTrigger
- Nudgr-V2/package.json
- functions/package.json
- Computer Use Agents - Sharp Edges
- backgroundGeofence.js
- fcm-regression.test.cjs
- NudgrNativeModule
- expo
- NudgrNativePackage.kt
- create_project.js
- NudgrNotificationActionReceiver.kt
- LocationFixtureService.java
- Nudgr-V2/src/ui/HomeScreen.js
- device-audit.cjs
- .showIncomingNotification
- .eslintrc.json
- worker/index.js
- MainActivity
- init.js
- CreateNudgeScreen.js
- baseline/Nudgr-V2/package.json
- FCM regression repair — verification report
- Computer Use Agents - Validations
- workflow-audit.test.cjs
- Universal Agent Instructions - Nudgr
- Computer Use Without Sandbox
- No Maximum Step Limit
- No Execution Timeout
- No Cost Tracking
- No Maximum Cost Limit
- No User Confirmation for Sensitive Actions
- No Action Logging
- Dangerous Bash Commands Not Blocked
- Full Resolution Screenshots
- No Screenshot Pruning in Context
- No Recovery From Failed Actions
- No Task Failure Handling
- Running as Root in Container
- Agents Are 2-5x Slower Than Humans
- Costs Can Explode Quickly
- Dropdowns, Scrollbars, and Drags Are Unreliable
- Web Content Can Hijack Your Agent
- Screenshots Fill Up Context Window Fast
- Running Agent on Your Actual Computer
- Vision Agents Click Exact Centers
- Sandbox With Full Network Access
- Container Without Capability Drops
- Container Without Seccomp Profile
- firestore-audit.test.cjs
- Nudgr — Project Context
- Nudgr — Production Hardening Handoff
- .record
- Computer Use Agents
- with
- Add verification after action
- Break into subtasks
- Rotate user agents and fingerprints
- CLAUDE.md
- .claude/CLAUDE.md
- qa-device.cjs
- Closed-app incoming Nudgr audit
- Agent Handoff: Critical Two-Phone Background Delivery Test & Complete Scenario Verification
- baseline/Nudgr-V2/src/db/nudges.js
- baseline/Nudgr-V2/src/ui/IncomingNudge.js
- NudgrSenderScheduleService
- delivery-hardening.test.cjs
- AmbientBackground
- baseline/Nudgr-V2/src/ui/CreateNudgeScreen.js
- Nudgr-V2/src/db/users.js
- Nudgr-V2/App.js
- connections-hardening.test.cjs
- baseline/Nudgr-V2/src/ui/MyConnectionScreen.js
- getAuth
- baseline/Nudgr-V2/App.js
- dependencies
- Nudgr-V2/src/ui/IncomingNudge.js
- runtime-hardening.test.cjs
- qa-server.cjs
- MainApplication.kt
- async-runtime.test.cjs
- Nudgr — Final End-to-End Workflow Audit
- devDependencies
- compilerOptions
- ref_node_fs
- verify-android-artifact.py
- baseline/Nudgr-V2/src/db/triggers.js
- baseline/Nudgr-V2/worker/index.js
- Nudgr production hardening and release preparation
- NudgrIncomingPolicyTest.kt
- scripts
- Verification stages
- nudge-deletion.test.cjs
- 11. Physical Device Verification
- Q: Nudgr final end-to-end workflow audit and next-phase readiness
- DeliveryHistory.js
- .get
- repeat-schedule.test.cjs
- NudgrReceiptService.kt
- install-physical.ps1
- Exact minimal corrections
- @react-native-firebase/app@25.1.0
- Nudgr-V2/src/ui/ErrorBoundary.js
- expo-status-bar@~57.0.1
- README.md
- NudgrNativeBridge.kt
- Sound
- expo-task-manager@~57.0.21
- expo-modules-core
- react-native@0.86.3
- react@19.2.3
- @react-native-async-storage/async-storage@2.2.0
- @react-native-firebase/auth@25.1.0
- react-native-worklets@0.10.1
- @react-native-firebase/messaging@25.1.0
- react-native-reanimated
- react-native-safe-area-context
- react-native-webview

## God Nodes (most connected - your core abstractions)
1. `NudgrApp()` - 41 edges
2. `getAuth()` - 38 edges
3. `Patterns` - 37 edges
4. `Computer Use Agents - Sharp Edges` - 27 edges
5. `CreateNudgeScreen()` - 24 edges
6. `getFirestore()` - 23 edges
7. `evaluateSenderNudges()` - 22 edges
8. `App()` - 22 edges
9. `getServerTimestamp()` - 21 edges
10. `NudgrNativeModule` - 20 edges

## Surprising Connections (you probably didn't know these)
- `3. Key Technical Findings & Architectural Solutions` --references--> `MainActivity`  [INFERRED]
  AI_CONTEXT/2026-10-30-PRE-AUDIT-HANDOFF.md → Nudgr-V2/android/app/src/main/java/com/nudgr/MainActivity.kt
- `1. Executive Summary` --references--> `evaluateSenderNudges()`  [INFERRED]
  AI_CONTEXT/2026-10-30-PRE-AUDIT-HANDOFF.md → Nudgr-V2/src/location/backgroundGeofence.js
- `5. Sender Geofencing Workflow` --references--> `registerGeofencesForNudges()`  [INFERRED]
  FINAL_WORKFLOW_AUDIT.md → Nudgr-V2/src/location/backgroundGeofence.js
- `8. Recipient Incoming Call Workflow` --references--> `MainActivity`  [INFERRED]
  FINAL_WORKFLOW_AUDIT.md → Nudgr-V2/android/app/src/main/java/com/nudgr/MainActivity.kt
- `2. Complete Architecture Overview` --references--> `MainApplication`  [INFERRED]
  FINAL_WORKFLOW_AUDIT.md → Nudgr-V2/android/app/src/main/java/com/nudgr/MainApplication.kt

## Import Cycles
- None detected.

## Communities (128 total, 44 thin omitted)

### Community 0 - "localNotifications.js"
Cohesion: 0.13
Nodes (25): getRuntimeStatuses(), getGeofenceDiagnostics(), checkAndRequestNotificationPermissions(), createAndScheduleTimeTestNudge(), dismissIncomingNudgeNotification(), getNotificationDiagnostics(), incomingNotificationInFlight, NUDGR_ALERTS_CHANNEL_ID (+17 more)

### Community 1 - "Patterns"
Cohesion: 0.05
Nodes (38): **Anti Patterns**, **Anti Patterns**, **Anti Patterns**, **Anti Patterns**, **Anti Patterns**, **Anti Patterns**, Computer Use Agents, **Description** (+30 more)

### Community 2 - "sendNudgeOnTrigger"
Cohesion: 0.12
Nodes (21): sendNudgeOnTrigger(), 7. Firebase and FCM Workflow, Applied changes, Audible ringtone failure confirmed separately, Closed-app notification fix and verification, Confirmed cause, Evidence, Exact change locations (+13 more)

### Community 3 - "Nudgr-V2/package.json"
Cohesion: 0.15
Nodes (12): expo-speech@~57.0.3, @react-native-firebase/crashlytics@25.1.0, @react-native-firebase/firestore@25.1.0, expo-speech, @react-native-firebase/firestore, license, main, name (+4 more)

### Community 4 - "functions/package.json"
Cohesion: 0.05
Nodes (50): functions, { getFirestore, FieldValue }, { getMessaging }, getVoiceDownloadUrl(), getVoiceUploadUrl(), { initializeApp }, { getAuth }, { getFirestore } (+42 more)

### Community 5 - "Computer Use Agents - Sharp Edges"
Cohesion: 0.09
Nodes (21): Accept the tradeoff, Add human-like variance to actions, ALWAYS use sandboxing, Break complex actions into steps, Computer Use Agents - Sharp Edges, Defense in depth - no single solution works, **Detection Pattern**, **Detection Pattern** (+13 more)

### Community 6 - "backgroundGeofence.js"
Cohesion: 0.05
Nodes (103): cancelNudge(), createNudge(), deleteNudge(), getNudge(), getNudgeStateSummary(), hideReceivedNudge(), isNudgeActive(), localDateKey() (+95 more)

### Community 7 - "fcm-regression.test.cjs"
Cohesion: 0.10
Nodes (14): @babel/parser@^7.28.0, assert, babel, collect(), fs, incomingPolicy, parser, path (+6 more)

### Community 9 - "expo"
Cohesion: 0.07
Nodes (27): backgroundColor, foregroundImage, adaptiveIcon, googleServicesFile, package, permissions, versionCode, expo (+19 more)

### Community 11 - "create_project.js"
Cohesion: 0.11
Nodes (13): androidAppDir, androidDir, appJson, assetsDir, fs, packageJson, path, projectDir (+5 more)

### Community 14 - "Nudgr-V2/src/ui/HomeScreen.js"
Cohesion: 0.24
Nodes (9): HomeScreen(), styles, PermissionNotice(), styles, DRAWER_WIDTH, HamburgerButton(), hamburgerStyles, SideMenu() (+1 more)

### Community 15 - "device-audit.cjs"
Cohesion: 0.11
Nodes (32): account, adb(), capture(), config, delay(), encode(), events(), fs (+24 more)

### Community 17 - ".eslintrc.json"
Cohesion: 0.22
Nodes (8): env, es2021, node, extends, parserOptions, ecmaVersion, rules, eslint:recommended

### Community 18 - "worker/index.js"
Cohesion: 0.36
Nodes (10): ALLOWED_CONTENT_TYPES, authenticateRequest(), canDeleteVoice(), canReadVoice(), corsHeaders(), decodeBase64Url(), fetch(), jsonResponse() (+2 more)

### Community 22 - "CreateNudgeScreen.js"
Cohesion: 0.06
Nodes (44): expo-audio@~57.0.5, RADIUS_DEFAULT_KM, RADIUS_MAX_KM, RADIUS_MIN_KM, COOLDOWN_PRESETS, CreateNudgeScreen(), hour24ToTimeState(), styles (+36 more)

### Community 26 - "baseline/Nudgr-V2/package.json"
Cohesion: 0.06
Nodes (46): dependencies, expo@~52.0.35, expo-asset@~11.0.5, expo-av@~15.0.2, expo-clipboard@~7.0.1, expo-location@~18.0.10, expo-notifications@~0.29.14, expo-speech@~13.0.1 (+38 more)

### Community 27 - "FCM regression repair — verification report"
Cohesion: 0.25
Nodes (7): Automated verification, Changes, Deployment and Android release, FCM regression repair — verification report, Practical limits, Real-device verification, Root cause and history

### Community 28 - "Computer Use Agents - Validations"
Cohesion: 0.29
Nodes (7): **Autofix**, Container Without Memory Limit, **Description**, **Id**, **Message**, **Pattern**, **Severity**

### Community 29 - "workflow-audit.test.cjs"
Cohesion: 0.07
Nodes (21): assert, AuditDate, babel, cases, { execFileSync }, fs, { generateKeyPairSync, sign, webcrypto }, jwk (+13 more)

### Community 30 - "Universal Agent Instructions - Nudgr"
Cohesion: 0.25
Nodes (7): 1. Central AI Knowledge System & Shared Memory, 2. Mandatory Agent Workflow, 3. Critical Prohibitions, 4. Graphify Codebase Intelligence, 5. Nudgr Project Specifics, graphify, Universal Agent Instructions - Nudgr

### Community 31 - "Computer Use Without Sandbox"
Cohesion: 0.25
Nodes (8): **Anti Pattern**, **Autofix**, Computer Use Without Sandbox, **Description**, **Id**, **Message**, **Pattern**, **Severity**

### Community 32 - "No Maximum Step Limit"
Cohesion: 0.25
Nodes (8): **Anti Pattern**, **Autofix**, **Description**, **Id**, **Message**, No Maximum Step Limit, **Pattern**, **Severity**

### Community 33 - "No Execution Timeout"
Cohesion: 0.25
Nodes (8): **Anti Pattern**, **Autofix**, **Description**, **Id**, **Message**, No Execution Timeout, **Pattern**, **Severity**

### Community 34 - "No Cost Tracking"
Cohesion: 0.25
Nodes (8): **Anti Pattern**, **Autofix**, **Description**, **Id**, **Message**, No Cost Tracking, **Pattern**, **Severity**

### Community 35 - "No Maximum Cost Limit"
Cohesion: 0.25
Nodes (8): **Anti Pattern**, **Autofix**, **Description**, **Id**, **Message**, No Maximum Cost Limit, **Pattern**, **Severity**

### Community 36 - "No User Confirmation for Sensitive Actions"
Cohesion: 0.25
Nodes (8): **Anti Pattern**, **Autofix**, **Description**, **Id**, **Message**, No User Confirmation for Sensitive Actions, **Pattern**, **Severity**

### Community 37 - "No Action Logging"
Cohesion: 0.25
Nodes (8): **Anti Pattern**, **Autofix**, **Description**, **Id**, **Message**, No Action Logging, **Pattern**, **Severity**

### Community 38 - "Dangerous Bash Commands Not Blocked"
Cohesion: 0.25
Nodes (8): **Anti Pattern**, **Autofix**, Dangerous Bash Commands Not Blocked, **Description**, **Id**, **Message**, **Pattern**, **Severity**

### Community 39 - "Full Resolution Screenshots"
Cohesion: 0.25
Nodes (8): **Anti Pattern**, **Autofix**, **Description**, Full Resolution Screenshots, **Id**, **Message**, **Pattern**, **Severity**

### Community 40 - "No Screenshot Pruning in Context"
Cohesion: 0.25
Nodes (8): **Anti Pattern**, **Autofix**, **Description**, **Id**, **Message**, No Screenshot Pruning in Context, **Pattern**, **Severity**

### Community 41 - "No Recovery From Failed Actions"
Cohesion: 0.25
Nodes (8): **Anti Pattern**, **Autofix**, **Description**, **Id**, **Message**, No Recovery From Failed Actions, **Pattern**, **Severity**

### Community 42 - "No Task Failure Handling"
Cohesion: 0.25
Nodes (8): **Anti Pattern**, **Autofix**, **Description**, **Id**, **Message**, No Task Failure Handling, **Pattern**, **Severity**

### Community 43 - "Running as Root in Container"
Cohesion: 0.25
Nodes (8): **Anti Pattern**, **Autofix**, **Description**, **Id**, **Message**, **Pattern**, Running as Root in Container, **Severity**

### Community 44 - "Agents Are 2-5x Slower Than Humans"
Cohesion: 0.29
Nodes (7): Agents Are 2-5x Slower Than Humans, **Id**, **Severity**, **Situation**, **Solution**, **Symptom**, **Why**

### Community 45 - "Costs Can Explode Quickly"
Cohesion: 0.29
Nodes (7): Costs Can Explode Quickly, **Id**, **Severity**, **Situation**, **Solution**, **Symptom**, **Why**

### Community 46 - "Dropdowns, Scrollbars, and Drags Are Unreliable"
Cohesion: 0.29
Nodes (7): Dropdowns, Scrollbars, and Drags Are Unreliable, **Id**, **Severity**, **Situation**, **Solution**, **Symptom**, **Why**

### Community 47 - "Web Content Can Hijack Your Agent"
Cohesion: 0.29
Nodes (7): **Id**, **Severity**, **Situation**, **Solution**, **Symptom**, Web Content Can Hijack Your Agent, **Why**

### Community 48 - "Screenshots Fill Up Context Window Fast"
Cohesion: 0.29
Nodes (7): **Id**, Screenshots Fill Up Context Window Fast, **Severity**, **Situation**, **Solution**, **Symptom**, **Why**

### Community 49 - "Running Agent on Your Actual Computer"
Cohesion: 0.29
Nodes (7): **Id**, Running Agent on Your Actual Computer, **Severity**, **Situation**, **Solution**, **Symptom**, **Why**

### Community 50 - "Vision Agents Click Exact Centers"
Cohesion: 0.29
Nodes (7): **Id**, **Severity**, **Situation**, **Solution**, **Symptom**, Vision Agents Click Exact Centers, **Why**

### Community 51 - "Sandbox With Full Network Access"
Cohesion: 0.22
Nodes (8): **Autofix**, Computer Use Agents - Validations, **Description**, **Id**, **Message**, **Pattern**, Sandbox With Full Network Access, **Severity**

### Community 52 - "Container Without Capability Drops"
Cohesion: 0.29
Nodes (7): **Autofix**, Container Without Capability Drops, **Description**, **Id**, **Message**, **Pattern**, **Severity**

### Community 53 - "Container Without Seccomp Profile"
Cohesion: 0.29
Nodes (7): **Autofix**, Container Without Seccomp Profile, **Description**, **Id**, **Message**, **Pattern**, **Severity**

### Community 54 - "firestore-audit.test.cjs"
Cohesion: 0.31
Nodes (8): assert, encode(), jwt(), nudge, request(), seed(), { test }, trigger()

### Community 55 - "Nudgr — Project Context"
Cohesion: 0.33
Nodes (5): Current state — 2026-11-17, Navigation, Nudgr — Project Context, Prior hardening state — 2026-10-31, Release constraints

### Community 56 - "Nudgr — Production Hardening Handoff"
Cohesion: 0.22
Nodes (8): Artifacts and validation, Cleanup/resume, Contracts and fixes, Nudgr — Latest Agent Handoff, Nudgr — Production Hardening Handoff (2026-10-31), Remaining release gates, Safe Dependency & Disk Cleanup (2026-11-03), Summary of 2026-11-17 Implementation

### Community 58 - "Computer Use Agents"
Cohesion: 0.50
Nodes (3): Computer Use Agents, Identity, Reference System Usage

### Community 59 - "with"
Cohesion: 0.05
Nodes (41): runs-on, steps, timeout-minutes, defaults, run, jobs, android-build-and-smoke, runtime-and-rules (+33 more)

### Community 65 - "qa-device.cjs"
Cohesion: 0.22
Nodes (19): adb, decode(), { execFileSync }, fill(), fs, main(), nodes(), option() (+11 more)

### Community 66 - "Closed-app incoming Nudgr audit"
Cohesion: 0.23
Nodes (5): NudgrFirebaseMessagingService, 2. Mutate the actual FCM Intent, Initial physical-device evidence (before installing the current build), Native presentation defect: notification suppression changes a copy, Other measured cases

### Community 67 - "Agent Handoff: Critical Two-Phone Background Delivery Test & Complete Scenario Verification"
Cohesion: 0.29
Nodes (6): 1. Executive Summary, 2. Mandatory Evidence Artifacts (`evidence/` & `Nudgr-V2/evidence/`), 3. Key Technical Findings & Architectural Solutions, 4. Directional & Core Regression Summary, 5. Repository & State Integrity, Agent Handoff: Critical Two-Phone Background Delivery Test & Complete Scenario Verification

### Community 68 - "baseline/Nudgr-V2/src/db/nudges.js"
Cohesion: 0.18
Nodes (22): App(), cancelNudge(), createNudge(), getNudge(), getNudgeStateSummary(), isNudgeActive(), localDateKey(), markCompleted() (+14 more)

### Community 69 - "baseline/Nudgr-V2/src/ui/IncomingNudge.js"
Cohesion: 0.18
Nodes (13): clearIncomingState(), getActiveRingingState(), getIncomingState(), INCOMING_STATES, setIncomingState(), startRingtone(), stopRingtone(), IncomingNudge() (+5 more)

### Community 71 - "delivery-hardening.test.cjs"
Cohesion: 0.12
Nodes (18): clipUtf8(), createDelivery(), cleanup(), deliver(), complete(), expireStaleDevices(), finish(), recipients() (+10 more)

### Community 72 - "AmbientBackground"
Cohesion: 0.10
Nodes (19): AmbientBackground(), styles, AUTH_ERRORS, AuthScreen(), friendlyAuthError(), styles, styles, HomeScreen() (+11 more)

### Community 73 - "baseline/Nudgr-V2/src/ui/CreateNudgeScreen.js"
Cohesion: 0.28
Nodes (13): CreateNudgeScreen(), styles, RadiusSlider(), TimePickerRoller(), getVoiceUploadUrl(), uploadVoiceNoteToR2(), discardRecording(), hasMicPermission() (+5 more)

### Community 74 - "Nudgr-V2/src/db/users.js"
Cohesion: 0.17
Nodes (23): generateConnectionCode(), normalizeConnectionCode(), connectByCode(), connectByCodeDirectFirestore(), connectionDocId(), subscribeConnections(), ensureUserProfile(), ensureUserProfileNow() (+15 more)

### Community 75 - "Nudgr-V2/App.js"
Cohesion: 0.19
Nodes (17): App(), NudgrApp(), styles, attachFcmListeners(), getActiveRingingState(), addNativeActionListener(), clearInitialNativeAction(), clearNativeAccountState() (+9 more)

### Community 76 - "connections-hardening.test.cjs"
Cohesion: 0.13
Nodes (16): createConnectionHandler(), error(), { getAuth }, { getFirestore, FieldValue }, handleConnectByCode, profile(), { createHash, randomBytes }, { FieldValue } (+8 more)

### Community 77 - "baseline/Nudgr-V2/src/ui/MyConnectionScreen.js"
Cohesion: 0.26
Nodes (8): connectByCode(), connectionDocId(), ensureUserProfile(), getUserProfile(), subscribeUserProfile(), userDoc(), MyConnectionScreen(), styles

### Community 78 - "getAuth"
Cohesion: 0.20
Nodes (14): attachFcmTokenRefresh(), getInstallationId(), removeFcmToken(), signedOutUsers, storeToken(), syncFcmToken(), tokenGenerations, userRef() (+6 more)

### Community 79 - "baseline/Nudgr-V2/App.js"
Cohesion: 0.15
Nodes (7): AppRoot(), styles, attachFcmTokenRefresh(), removeFcmToken(), syncFcmToken(), userRef(), ErrorBoundary

### Community 80 - "dependencies"
Cohesion: 0.12
Nodes (16): dependencies, expo@57.0.31, expo-asset@~57.0.20, expo-clipboard@~57.0.2, expo-haptics@~57.0.3, expo-location@~57.0.22, expo-notifications@~57.0.23, promise@8.3.0 (+8 more)

### Community 81 - "Nudgr-V2/src/ui/IncomingNudge.js"
Cohesion: 0.17
Nodes (16): isQaBuild, clearIncomingState(), getIncomingState(), INCOMING_STATES, setIncomingState(), getNativeIncomingState(), isNativeNotificationActive(), setNativeIncomingState() (+8 more)

### Community 82 - "runtime-hardening.test.cjs"
Cohesion: 0.12
Nodes (13): Clock, assert, { createSessionManager }, fs, { nextSenderWakeup }, { parseIncoming }, path, root (+5 more)

### Community 83 - "qa-server.cjs"
Cohesion: 0.15
Nodes (14): argv, { createRequire }, express, firestorePort, fnRequire, fs, liveFcm, main() (+6 more)

### Community 85 - "async-runtime.test.cjs"
Cohesion: 0.15
Nodes (8): assert, babel, fs, load(), nudgeApi(), path, { test }, vm

### Community 86 - "Nudgr — Final End-to-End Workflow Audit"
Cohesion: 0.14
Nodes (14): 10. Testing Results, 12. Bugs Found and Fixes, 13. Remaining Limitations, 14. Production Readiness Assessment, 15. Next Development Phase, 1. Executive Summary, 3. Authentication Workflow, 4. Nudgr Creation Workflow (+6 more)

### Community 87 - "devDependencies"
Cohesion: 0.14
Nodes (13): devDependencies, @babel/plugin-transform-modules-commonjs@^7.27.1, eslint@^10.14.0, @eslint/js@^10.0.1, globals@^16.5.0, @types/react@~19.2.2, typescript@6.0.3, eslint (+5 more)

### Community 88 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, allowJs, checkJs, module, moduleResolution, noEmit, noImplicitAny, skipLibCheck (+4 more)

### Community 89 - "ref_node_fs"
Cohesion: 0.18
Nodes (8): fs, main(), option(), fixture, fs, path, root, targets

### Community 91 - "baseline/Nudgr-V2/src/db/triggers.js"
Cohesion: 0.33
Nodes (8): createTriggerEvent(), fnv1a64(), generateTriggerEventId(), getTriggerEvent(), subscribeTriggerEvents(), TRIGGER_COOLDOWN_MS, triggerEventsRef(), updateTriggerEventStatus()

### Community 92 - "baseline/Nudgr-V2/worker/index.js"
Cohesion: 0.40
Nodes (9): ALLOWED_CONTENT_TYPES, authenticateRequest(), canReadVoice(), corsHeaders(), decodeBase64Url(), fetch(), jsonResponse(), parseAndValidateFirebaseToken() (+1 more)

### Community 93 - "Nudgr production hardening and release preparation"
Cohesion: 0.20
Nodes (8): Artifacts, Cleanup, Dependency review, Deployment and rollback review, Evidence limits, Implemented changes, Nudgr production hardening and release preparation, Validation

### Community 95 - "scripts"
Cohesion: 0.22
Nodes (9): scripts, android, check, ios, lint, start, test, test:integration (+1 more)

### Community 96 - "Verification stages"
Cohesion: 0.33
Nodes (6): Backend after deployment, before correcting Phone B's installed token writer, Corrected cold-open handoff, before audible asset repair, Foreground regression and final build, Native corrected build and closed-process test (Recents card retained), Phone B explicitly swiped out of Recents, process dead, Verification stages

### Community 97 - "nudge-deletion.test.cjs"
Cohesion: 0.09
Nodes (17): createNudgeDeletionHandler(), fallbackRecursiveDelete(), { getAuth }, { getFirestore }, handleDeleteNudge, httpError(), assert, babel (+9 more)

### Community 98 - "11. Physical Device Verification"
Cohesion: 0.40
Nodes (5): 11. Physical Device Verification, Devices and scope, New successful foreground case, Numbered latest evidence, Requested historical case

### Community 99 - "Q: Nudgr final end-to-end workflow audit and next-phase readiness"
Cohesion: 0.40
Nodes (4): Answer, Outcome, Q: Nudgr final end-to-end workflow audit and next-phase readiness, Source Nodes

### Community 100 - "DeliveryHistory.js"
Cohesion: 0.33
Nodes (8): subscribeTriggerEvents(), DELIVERY_TTL_MS, IncomingPayload, parseIncoming(), timestampMillis(), validId(), DeliveryAttempt(), DeliveryHistory()

### Community 102 - "repeat-schedule.test.cjs"
Cohesion: 0.12
Nodes (14): @babel/core@^7.28.0, assert, babel, fs, geo, loadTsRuntime(), { nextSenderWakeup }, path (+6 more)

### Community 104 - "install-physical.ps1"
Cohesion: 0.48
Nodes (4): Get-PhysicalDevices(), Get-Property(), Invoke-Native(), Require-Success()

### Community 105 - "Exact minimal corrections"
Cohesion: 0.40
Nodes (5): 1. Correct both token registration writes, 3. Make the existing native helper own Android background posting, 4. Declare and check full-screen capability, 5. Preserve call ringing and action meaning, Exact minimal corrections

### Community 107 - "Nudgr-V2/src/ui/ErrorBoundary.js"
Cohesion: 0.24
Nodes (4): reportUiError(), ErrorBoundary, styles, THEME

## Knowledge Gaps
- **1 isolated node(s):** `eslint:recommended`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 742 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **44 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Exact change locations` connect `sendNudgeOnTrigger` to `Closed-app incoming Nudgr audit`, `.get`, `Nudgr-V2/src/db/users.js`, `getAuth`, `.showIncomingNotification`, `MainActivity`?**
  _High betweenness centrality (0.131) - this node is a cross-community bridge._
- **What connects `eslint:recommended` to the rest of the system?**
  _1 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `localNotifications.js` be split into smaller, more focused modules?**
  _Cohesion score 0.1339031339031339 - nodes in this community are weakly interconnected._
- **Why does `getFirestore()` connect `Nudgr-V2/src/db/users.js` to `getAuth`, `sendNudgeOnTrigger`, `DeliveryHistory.js`, `backgroundGeofence.js`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Should `Patterns` be split into smaller, more focused modules?**
  _Cohesion score 0.05128205128205128 - nodes in this community are weakly interconnected._
- **Why does `sendNudgeOnTrigger()` connect `sendNudgeOnTrigger` to `Exact minimal corrections`, `functions/package.json`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **Should `sendNudgeOnTrigger` be split into smaller, more focused modules?**
  _Cohesion score 0.11594202898550725 - nodes in this community are weakly interconnected._