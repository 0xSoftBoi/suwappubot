# Gusto — in-app admin UI, verified from help-article step text (headless browser, Nov 2026)

Method: support.gusto.com articles loaded via Playwright, reading collapsed accordion text. All URLs returned 200. No logged-in screen or vendor demo was reached.

## Navigation
- **Left menu** exists; confirmed sections: **Home**, **Pay**, **People**, **Reports** ("If you do not see Reports in the left menu…"). [101334493100000](https://support.gusto.com/article/101334493100000) [999754831000000](https://support.gusto.com/article/999754831000000) [106622033100000](https://support.gusto.com/article/106622033100000) [102787011100000](https://support.gusto.com/article/102787011100000) [178361225624246](https://support.gusto.com/article/178361225624246)
- **Top bar:** bell (Notifications Center) and help icon top-right of every page; click your name (top right) → **Settings** → **Permissions** tab. [178361225624246] [240829150046240](https://support.gusto.com/article/240829150046240)
- **Billing** section holds invoices; **Tax documents** and **Paystubs** reachable from Reports area. [101334493100000]
- **Admin permission areas** (likely mirror product areas): Pay, Hire and onboard, Manage and offboard, Documents, Reports, Time & Attendance, Benefits, Integrations. Roles: Primary/Account owner, Full access, Limited, Custom (Plus/Premium), People Manager. [114138050100000](https://support.gusto.com/article/114138050100000)
- **Mobile app tabs:** Pay, People, Reports; Pay has "See more options". [100739998100000](https://support.gusto.com/article/100739998100000)

## Home
- Widgets: **Tasks** (top 3 priority tasks, "View all tasks") and **Recent activity** ("View all updates") → Notifications Center with **Tasks** / **Activity** tabs. [178361225624246]
- Approval to-dos on Home: "Review request", "Update payroll". [240829150046240]
- After people are added, "the home page turns into a to-do list with deadlines" (third-party). [connecteam](https://www.connecteam.com/reviews/gusto/)

## Run payroll (spreadsheet view) [999754831000000]
1. **Pay** → upcoming payrolls with run-by date and payday; tile shows **Payroll deadline** and **Payday** → **Run payroll**.
2. **Spreadsheet:** synced hours/salary prefilled; decimal hours; **Columns** button shows/hides earnings columns; expand arrow for multi-job rows; one-time earnings columns (bonus, commission, correction payment, custom earning); **Regular hours**, **Overtime hours**, **Double overtime** (N/A if ineligible); time off, tips, personal note on pay stub, edit team member during payroll.
3. **Review summary** (bottom button): **Flagged pay changes or trends** with **Edit** / **Dismiss** above "Payroll details" [260112145935220](https://support.gusto.com/article/260112145935220); expandable **What will get taxed and debited**, **What your employees worked and take home**, **What your company will pay**; withdrawal amount.
4. **Submit payroll** (bottom right); check stock prompt (Top / Bottom, starting check number), **See printable checks** / **Done**.
5. **Confirmation:** **See the full summary**, **Print checks**, **Export payroll details**, **Download cash requirement report**, **Cancel this payroll** (irreversible, data saved); confirmation email.
6. **Switch to legacy view** / **Switch to spreadsheet view**; default via "Need help?" → "Payroll spreadsheet" → "Choose your default".
- Rules: submit by 4 pm PT run-by date; debit after 4 pm PT deadline; can cancel/resubmit before; failed debit $100; Instant Bank Verification suggested.
- Other actions: **Skip payroll**, **Run an off-cycle payroll** [999908231000000](https://support.gusto.com/article/999908231000000), **Extra pay (bonus)** [999946501000000](https://support.gusto.com/article/999946501000000), dismissal. **Payroll on Autopilot** toggle [999755421000000](https://support.gusto.com/article/999755421000000).

## Approvals [240829150046240]
- Enable: Pay → top **Settings** → **Approvals** → **Edit** next to **Payrolls need approval** → Yes → **Save**; choose **primary approver** if several full-access admins; **Manage** link.
- Request: Run payroll → spreadsheet → **Review summary** → **Request approval** → payroll locks, full-access admins emailed; **Cancel this request** unlocks.
- Review: email **Let's do it**, or Pay → Run payroll shows "This payroll needs to be reviewed"; **Submit payroll** / **Edit payroll** / **Decline request**; decline → email + Home to-do "Update payroll".
- Scope: regular, off-cycle, new hire, transition, 401(k) max-out, correction (+extra pay/dismissal if available); not contractor, Canadian, reversal. Free all plans. Enabling disables Autopilot for that payroll.
- Limited-admin "edit access": name → Settings → **Permissions** → employee → Edit in Pay box → Run payroll → Edit access.
- **Activity log:** Pay → **View pay history** → **View activity log**; events turned on/off, requested, canceled, declined, submitted.

## Contractors
- **US manual** [100739998100000]: Pay → More options → **Pay US contractors** → "Step 1 of 2" **Edit payments** (hours/rate or fixed, Bonus, Reimbursements, Tips, Cash tips, Invoice, Memo; autosave "Last saved"; **Import payment data** CSV/invoices) → **Review summary** → "Step 2 of 2" **Review and submit** → **Submit**; cancel payments before debit.
- **US automated:** **Set up automated payment** → select contractors → nickname → frequency (Every week, Every other week, Twice per month, Monthly) → first debit date, **Preview paydays** → details + **Add Memo** → **Turn on payment**; list with **Active** toggle + Actions menu.
- Facts: direct deposit or check (Gusto doesn't mail); $6/$12/$22 per contractor/month by plan; Same-day/Instant eligible; W-9 at People → contractor → Additional → Documents. Pay history **Payrolls** tab; **Recent contractor payments** card. [102787011100000]
- **International** [106622337100000](https://support.gusto.com/article/106622337100000): contractor completes W-8BEN/W-8BEN-E + payment method; one-time or automated; exchange rate, fee, estimated delivery shown before submit; min $25, max $100,000 pending; default bank only; contractor sees "In progress". Fees: US bank $5; local bank local currency 1.5–2%; local bank USD 0.75–1.5% ($15–$100); digital wallet 1.5%; crypto wallet pays **USDC**, Wise pays USD. Sync: Pay → View pay history → **Non-US contractors** → payday → **Sync**.

## People profile
- People → name → **Work** tab ("Job and compensation", **Manage work address**, "Employment info"), **Additional** → **Documents** (**Add Document**, Actions menu) and **Notes** (**Add note**). [106622033100000] [101895146100000](https://support.gusto.com/article/101895146100000)

## Reports [101334493100000]
- PDF / CSV / Excel; totals by check date; some reports emailable.
- Names: 1099 tax forms, Agency payments, Attendance, Bank transactions, Benefits, Cash requirements, Contractor information, Contractor payments, Custom report, Expenses, General ledger, Payroll data export, Payroll journal, Payroll summary, Time off, Workers, Year-to-date, Tax deferrals (conditional). (Plus earlier list: Reports by department, Workforce costing, Job costing, Labor cost allocation, Time-tracking hours, Workers' comp audit, Pre-tax benefit accounts, Compensation change history.)
- Payroll summary: Pay → **Pay History** → check date → **Download**; pay history summary shows All taxes, Payments, Paystubs, Employees, Bank account used. [102787011100000]

## UNVERIFIED
Full left-menu order and items beyond Home/Pay/People/Reports; Home modules beyond the two widgets; profile tabs beyond Work/Additional; Settings sub-tabs beyond Permissions; custom report builder steps; in-app Taxes screens.
