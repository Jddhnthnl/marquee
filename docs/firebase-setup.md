# Firebase setup for Marquee login and sync

Takes about 10 minutes and uses the free Spark plan, so no card is needed.

## 1. Create the project
1. Go to https://console.firebase.google.com and sign in with your Google account.
2. Click **Create a project**, name it `marquee`, and click through. Turn **Google Analytics** off because Marquee doesn't need it.

## 2. Turn on email/password login
1. In the left menu: **Build → Authentication → Get started**.
2. On the **Sign-in method** tab, choose **Email/Password**, switch on the first toggle (not "Email link"), and click **Save**.
3. On the **Settings** tab, open **User actions** and leave **"Enable create (sign-up)"** ticked. Anyone can try to make an account in the app, but only invited emails are kept: other accounts are deleted at once, and invited ones must confirm their email first.
4. On the **Users** tab, click **Add user** and enter your own email and a password. Friends make their own accounts in the app after you invite them.

## 3. Create the database
1. **Build → Firestore Database → Create database**.
2. Location: `asia-southeast1` (Singapore), or whichever region is closest to you. This can't be changed later.
3. Start in **production mode**.
4. On the **Rules** tab, replace everything with the contents of [`firestore.rules`](../firestore.rules) from this repo and click **Publish**.

## 4. Invite list
Rules only let in accounts whose email is on the invite list.
1. On the Firestore **Data** tab, click **Start collection** and set the collection ID to `allowlist`.
2. Set the document ID to your email in **lowercase** (e.g. `you@gmail.com`). Add one field, `added` (type boolean, value `true`), and save.
3. Make yourself the admin: start a collection `admins`, set the document ID to your **User UID** (copy it from Authentication → Users), and add a field `added` (boolean, `true`).
4. Your own account must have a confirmed email. Accounts added from the console start unconfirmed. Sign in once in the app, and it sends you the confirmation link.

After that, invite and remove friends in the app under **Settings → System → Invites**. A removed friend is signed out the next time they open Marquee. You can also disable someone under Authentication → Users.

## 5. Send me the config
1. Click the ⚙ next to **Project Overview → Project settings**.
2. Under **Your apps**, click the **</>** (Web) icon, name it `marquee-desktop`, leave Hosting unticked, and click **Register app**.
3. Copy the `firebaseConfig = { ... }` block and paste it into the chat.

These values are not passwords: they only identify the project, and the rules above do the protecting. Don't paste anything from **Service accounts**, though; that one *is* a secret.
