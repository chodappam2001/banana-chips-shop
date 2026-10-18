# SunnyChips retailer shop — setup and publishing

The storefront uses Supabase for email/password accounts, shared products, and orders. Orders are requests; confirm stock, delivery, and payment with each retailer. The site does not charge cards.

## 1. Connect the database

1. Open your Supabase project and go to **SQL Editor → New query**.
2. In VS Code, open `supabase/schema.sql`, copy all of it, paste it into the SQL Editor, and run it once. A message saying “Success. No rows returned” is normal for setup SQL.
3. In **Project Settings → API**, copy the Project URL and the **publishable** key (older projects may call it `anon`). Never put a `secret` or `service_role` key in browser code.
4. Put those two values in `config.js` and save.

## 2. Enable email and set redirect URLs

1. In Supabase, open **Authentication → Sign In / Providers** (the wording may appear as **Providers** under Authentication) and make sure **Email** is enabled. Phone login and SMS are not used by this site.
2. Keep email confirmation enabled if you want accounts to verify their email addresses.
3. Open **Authentication → URL Configuration**. Set **Site URL** to the address you use to open the site. For local development, this is usually `http://localhost:8000`. Add that address to **Redirect URLs** too; if Supabase accepts wildcard paths, add `http://localhost:8000/**`.
4. When deployed, also add the full Vercel site URL (for example `https://your-site.vercel.app`) to Site URL or Redirect URLs. Email confirmation links must be allowed to return to the website.
5. New visitors can choose **Create retailer account** and enter their contact name, business name, phone, delivery address, email, and a password of at least 8 characters. These details are saved with the Supabase Auth user profile and prefilled on future orders. Existing users choose **Sign in**. If email confirmation is enabled, they must click the confirmation link before signing in.

Supabase's built-in email sender is intended for limited testing and may only deliver to project-team addresses, with low sending limits. For public retailer registration, configure custom SMTP in Supabase **Authentication → SMTP Settings** using an email provider. The order notification email setup below is separate from authentication SMTP.

## 3. Give your account owner controls

1. Create an account on the site using your own email. If confirmation is enabled, confirm it from your inbox and sign in once.
2. In Supabase **SQL Editor**, run this query after replacing the address with that exact, verified owner email:

   ```sql
   insert into public.store_admins (user_id)
   select id from auth.users where lower(email) = lower('OWNER_EMAIL')
   on conflict do nothing;
   ```

3. Sign out and back in. The owner can open **Owner dashboard** in the shop header, or visit `owner-dashboard.html`. From there the owner can add, edit, hide, and delete products, change every product detail and price, and view/update orders. Other accounts can browse and place order requests.

## 4. Email yourself when an order arrives

1. Create an account at [Resend](https://resend.com/) and verify a sender domain/address. `ORDER_FROM_EMAIL` must be an allowed sender in Resend.
2. Open a VS Code terminal in this project folder and link the Supabase project:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```

   The project ref is the text before `.supabase.co` in your Supabase project URL.

3. Set the order notification secrets (replace the example values):

   ```powershell
   npx supabase secrets set ORDER_NOTIFICATION_EMAIL=you@example.com ORDER_FROM_EMAIL=orders@your-verified-domain.com RESEND_API_KEY=re_your_secret_key
   ```

4. Deploy the order handler:

   ```powershell
   npx supabase functions deploy retailer-order
   ```

The function checks current database prices, saves the retailer's order details, and sends your notification email. If email delivery fails, the order still appears in the owner dashboard. Keep the Resend API key and Supabase service role key out of website files.

## 5. Publish the site

1. Create a GitHub repository and publish this project folder from VS Code Source Control.
2. Import the repository into Vercel and deploy it as a static site. Use the project root; there is no build command.
3. Add your deployed Vercel URL to Supabase **Authentication → URL Configuration → Redirect URLs** so confirmation links return to the live site.
4. Test sign-up, email confirmation, sign-in, product management, and a test order on the deployed URL. Add a custom domain in Vercel if desired, and allow that URL in Supabase too.

## Orders and customer information

- The owner can see each retailer's name, business, phone, email, delivery address, requested products, total, and order status. The retailer phone field is for order contact; it is not used for login.
- The order function recalculates totals using current database prices. Delivery fees and tax are not included in the basket subtotal; confirm them with the retailer.
- Before accepting public orders, add your privacy, contact, delivery, and returns information, and configure suitable anti-abuse limits for sign-up and order submission.
