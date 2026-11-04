# Firebase setup for Marquee login and sync

Takes about 10 minutes and uses the free Spark plan, so no card is needed.

## 1. Create the project
1. Go to https://console.firebase.google.com and sign in with your Google account.
2. Click **Create a project**, name it `marquee`, and click through. Turn **Google Analytics** off because Marquee doesn't need it.

## 2. Turn on email/password login
1. In the left menu: **Build → Authentication → Get started**.
2. On the **Sign-in method** tab, choose **Email/Password**, switch on the first toggle (not "Email link"), and click **Save**.
3. On the **Settings** tab, open **User actions** and **untick "Enable create (sign-up)"**. Accounts can now only be made by you, from the console.
4. On the **Users** tab, click **Add user** and enter your email and a password. Repeat for each friend.

## 3. Create the database
1. **Build → Firestore Database → Create database**.
2. Location: `asia-southeast1` (Singapore), or whichever region is closest to you. This can't be changed later.
3. Start in **production mode**.
4. On the **Rules** tab, replace everything with the contents of [`firestore.rules`](../firestore.rules) from this repo and click **Publish**.

## 4. Invite list
Rules only let in accounts whose email is on the invite list.
1. On the Firestore **Data** tab, click **Start collection** and set the collection ID to `allowlist`.
2. Set the document ID to your email in **lowercase** (e.g. `you@gmail.com`). Add one field, `added` (type boolean, value `true`), and save.
3. Add one document like this for each friend.

To remove someone, delete their allowlist document; you can also disable them under Authentication → Users.

## 5. Send me the config
1. Click the ⚙ next to **Project Overview → Project settings**.
2. Under **Your apps**, click the **</>** (Web) icon, name it `marquee-desktop`, leave Hosting unticked, and click **Register app**.
3. Copy the `firebaseConfig = { ... }` block and paste it into the chat.

These values are not passwords: they only identify the project, and the rules above do the protecting. Don't paste anything from **Service accounts**, though; that one *is* a secret.
