window.LAUNCHPAD_CONTENT = window.LAUNCHPAD_CONTENT || { weeks: [], scripts: [], templates: [], rolePlays: [] };

// Launchpad 300.30.3 - spoken scripts library.
// Jess Densley's wording is kept verbatim (typos fixed, placeholders adapted to Ray White Mildura).
// Anything labelled "office wording" or "office guidance" is ours, not Jess's.

window.LAUNCHPAD_CONTENT.scripts.push(
{
  id: "train-to-prospect-phone",
  title: "Train To Prospect (phone)",
  category: "Prospecting",
  when: "Every cold call to a homeowner in your geographic farm area: this is the call that turns a name on a list into a piece of geo data.",
  goal: "A win is a name, address and phone number (email too if you can get it) written down and ready for the CRM, plus an honest answer to the 12-month question.",
  steps: [
    { label: "Introduce", line: "Hi (name), I'm (your name) from Ray White Mildura." },
    { label: "Reason", line: "I'm touching base because (lead magnet). Your friends and neighbours have loved receiving it. It tells them what's going on in the marketplace." },
    { label: "Offer", line: "If I can grab your details, I'd love to send one to you." },
    { label: "Collect details", line: "(Write down their name, address and phone number. Ask for an email as well so the market update can go both ways.)" },
    { label: "Seek for opportunity", line: "Is there any real estate needs that we can assist you with in the next 12 months?" },
    { label: "Next steps", line: "Thanks for that. I'll have that (lead magnet) to you shortly." }
  ],
  tips: [
    "The reason is the lead magnet, so hold it in your hand before you dial: know what it is, what is in it and why a neighbour would want it.",
    "One completed call with name, address and phone (or email) in the CRM is one of your 300. Thirty prepared names before every session, no computer, notepad only.",
    "Jess's session benchmark: 18 to 24 calls, 8 to 12 connections, 1 to 3 appointments in 45 minutes. Strike them off the call sheet as you go.",
    "A yes to the 12-month question goes straight onto your pipeline list and gets an appraisal offer on the spot: Does 2pm or 4pm suit?"
  ],
  source: "prospecting-scripts--prospecting-scripts.md"
},
{
  id: "train-to-prospect-door",
  title: "Train To Prospect (door)",
  category: "Prospecting",
  when: "Door knocking your farm area with one copy of the lead magnet in your hand and the rest in the car.",
  goal: "A win is a name and phone number (and email) to go with the address you are standing at, plus an honest answer to the 12-month question.",
  steps: [
    { label: "Introduce", line: "Hi (name), I'm (your name) from Ray White Mildura." },
    { label: "Reason", line: "I'm touching base because (lead magnet). Your friends and neighbours have loved receiving it. It tells them what's going on in the marketplace." },
    { label: "Offer", line: "Just carrying one for show today. If I can grab your details, I'd love to send one to you." },
    { label: "Collect details", line: "(Write down their name and phone number. You already have the address. Ask for an email as well.)" },
    { label: "Seek for opportunity", line: "Is there any real estate needs that we can assist you with in the next 12 months?" },
    { label: "Next steps", line: "Thanks for that. I'll have that (lead magnet) to you shortly." }
  ],
  tips: [
    "Carry one copy only. 'Just carrying one for show' is what makes the exchange natural: they get it in the mail, you get a record.",
    "At the door you rarely know the name first. Say 'Hi there', then ask for it when you collect details. You already have the address, so you are one phone number away from a piece of geo data.",
    "Knock in daylight, stand back from the door, smile before it opens. If no one answers, note the address, come back at a different time of day, and call the number if the office database has one.",
    "Pair the door with the phone: knock a street in the afternoon, then call the numbers you collected in your next morning session."
  ],
  source: "prospecting-scripts--prospecting-scripts.md"
},
{
  id: "two-minute-rule",
  title: "The 2 Minute Rule close",
  category: "Prospecting",
  when: "Any call that passes two minutes: the conversation is going well, so close for an appointment instead of talking on.",
  goal: "An appointment in the diary with a day and a time, booked before the call drifts.",
  steps: [
    { label: "Wrap up warmly", line: "It's been great chatting, I have my next appointment coming up." },
    { label: "Give the reason", line: "I am going to be in your area over the next few days seeing some of your friends and neighbours." },
    { label: "Invite", line: "It would be great to catch up and finish our conversation further." },
    { label: "Offer two times", line: "Does 2pm or 4pm suit?" }
  ],
  tips: [
    "Jess's rule: if you are on the phone for 2 minutes or longer you need to be looking to close the call and book an appointment.",
    "Two options, not an open question. 'When suits?' gets 'I'll let you know'. '2pm or 4pm?' gets a time.",
    "The appointment is usually a market report drop that becomes a 15-minute appraisal. Each one is a step toward your 30.",
    "If neither time works, offer two more. If they still say no, book the next call instead and move on; keep the session moving."
  ],
  source: "client-connections--prospecting-call-scripts.md"
},
{
  id: "magic-50",
  title: "Magic 50 calls",
  category: "Prospecting",
  when: "Within days of any listing or sale near your farm (ours or another agent's), call the 50 closest homes.",
  goal: "Updated details on 50 neighbours, permission to call every one of them back when it sells, and at least one 'who do you know' lead.",
  steps: [
    { label: "Greet and build rapport", line: "Hi, it's (your name) from Ray White Mildura. (Build rapport.)" },
    { label: "Courtesy reason", line: "Just a courtesy call today to inform you we have just listed / another agent has listed / sold (address) near your property. The owners of that property have asked us to inform all of the locals in the area that there will be additional traffic in the area over the next month." },
    { label: "Offer the result", line: "I thought you may be interested as a local property owner what the result is of (address)." },
    { label: "If yes", line: "That's great, I will let you know the result when it sells." },
    { label: "Update details", line: "(Confirm name, address, phone and email while you have them.)" },
    { label: "Just before I go", line: "Just before I go today, do you know of anyone in the area who may be considering selling? We have a cash buyer looking in your immediate area and they have asked us if we wouldn't mind calling around home owners in the area." }
  ],
  tips: [
    "A yes to 'I will let you know the result' is permission for a second call. That is two touches from one listing, which is how a board in the street turns into geo data and the next appraisal.",
    "The listing does not have to be ours. Any board in the street is a reason to call 50 homes.",
    "Only mention the cash buyer if we actually have one. Ask Damian or Luke who is on the office buyer list before the session.",
    "Fifty calls is two to three 45-minute sessions at Jess's pace of 18 to 24 calls a session. Prepare the 50 names and numbers the day the board goes up."
  ],
  source: "client-connections--prospecting-call-scripts.md"
},
{
  id: "quarterly-market-update-call",
  title: "Quarterly market update call",
  category: "Prospecting",
  when: "The week after the quarterly market update goes out to your farm, call every home that received it.",
  goal: "Confirmed details for every contact, a resend where it did not arrive, and any 12-month need noted on the pipeline list.",
  steps: [
    { label: "Greet and build rapport", line: "Hi Mr and Mrs (name), it's (your name) from Ray White Mildura. (Build rapport.)" },
    { label: "Did it arrive?", line: "Just a courtesy call today to see if you received our recent quarterly market update? (If not, confirm details for another one.)" },
    { label: "Any needs?", line: "Is there any other real estate needs I can help you out with this quarter? (Confirm all details again.)" },
    { label: "Update details", line: "(Check the record: name, address, phone, email. Fix anything that has changed.)" },
    { label: "Just before I go", line: "Just before I go today, do you know of anyone in the area who may be considering selling? We have a cash buyer looking in your immediate area and they have asked us if we wouldn't mind calling around home owners in the area." }
  ],
  tips: [
    "'Did you get it?' is the easiest question in real estate. It is a reason to call that asks nothing of them.",
    "A 'no, it didn't arrive' is a gift: you get to confirm the address, send it again, and the record gets cleaned.",
    "Every call ends with the referral ask. One seller name a week from these calls is a month of appraisals over the program.",
    "The Client Connection Model builds to a set number of calls per contact per year. A quarterly call to every record is the simplest way to hit it."
  ],
  source: "client-connections--prospecting-call-scripts.md"
},
{
  id: "database-call-script",
  title: "The database call script",
  category: "Prospecting",
  when: "Calling warm contacts already in the database (past enquiries, people you have met, the office database) after a newsletter goes out.",
  goal: "A friendly two-minute call that confirms the newsletter arrived, adds one personal note to the record, and surfaces any real estate need this quarter.",
  steps: [
    { label: "Greet", line: "Hi. It's (your name) here from Ray White Mildura." },
    { label: "Quick call", line: "I won't take up too much of your time today, I understand you are busy, it's just a quick call." },
    { label: "Received", line: "We recently sent out our quarterly market update newsletter. I just wanted to make sure you received it ok? (If no, resend.)" },
    { label: "Activity", line: "The market has been strong with (number) sales and our median price increasing by (percent) which is great." },
    { label: "Rapport", line: "How is everything going? Last time we spoke your son Billy was starting footy, how is he going?" },
    { label: "Real estate needs", line: "Before I go, do you have any real estate needs that I can assist with this quarter?" }
  ],
  tips: [
    "'It's just a quick call' lowers the guard. Then keep the promise: aim to be off in two minutes unless they want to talk, and if they do, the 2 Minute Rule applies.",
    "The activity line only works with real numbers. Get this month's office sales and median from Damian or Luke before the session and write them on your call sheet. Say what the numbers actually say, and never quote a figure you cannot back up.",
    "The rapport beat is why you take notes. 'Billy starting footy' is Jess's example; your version comes from the last note in the CRM. If there is no note, this call makes one.",
    "This is communication over information. The newsletter is the information; the call is the relationship."
  ],
  source: "client-connections--the-client-connection-model-interactive.md"
},
{
  id: "call-toolkit",
  title: "Call toolkit: extenders, appointment setters, enders",
  category: "Prospecting",
  when: "On every call: extenders keep them talking, setters go in the moment there is a reason to meet, enders get you off cleanly and keep the session moving.",
  goal: "You control the length and the ending of every call, and any call worth two minutes ends with a time in the diary.",
  steps: [
    { label: "Extender", line: "Why's that?" },
    { label: "Extender", line: "Tell me more..." },
    { label: "Extender", line: "What do you mean?" },
    { label: "Extender", line: "Mmhm..." },
    { label: "Extender", line: "Uhuh..." },
    { label: "Extender", line: "How can I help?" },
    { label: "Appointment setter", line: "Where to from here?" },
    { label: "Appointment setter", line: "What are the next steps?" },
    { label: "Appointment setter", line: "Cool, we need to meet." },
    { label: "Appointment setter", line: "Can you do tomorrow 2pm or 4pm?" },
    { label: "Appointment setter", line: "Based on that, when should we speak next?" },
    { label: "Conversation ender", line: "I know you're busy, I'll let you go now." },
    { label: "Conversation ender", line: "I have another appointment to get to now." },
    { label: "Conversation ender", line: "Let's catch up when I'm in your area next week. Does 2pm or 4pm suit?" }
  ],
  tips: [
    "Extenders are short on purpose. Ask, then stop talking. The silence after 'Why's that?' is where people tell you they are thinking of selling.",
    "Pick one setter and one ender and make them yours this week. Write them at the top of the daily call sheet.",
    "An ender with a time attached ('Does 2pm or 4pm suit?') is an appointment setter in disguise. Use it on anyone warm.",
    "Session pace matters: 18 to 24 calls in 45 minutes leaves no room for ten-minute chats that go nowhere. Extend the good ones, end the rest."
  ],
  source: "client-connections--prospecting-call-scripts.md"
},
{
  id: "pipeline-1-2-month-call",
  title: "1 to 2 month pipeline call",
  category: "Pipeline",
  when: "Weekly, to every seller who is likely to list in the next one to two months, picking one reason to call each time.",
  goal: "An easy, useful call that keeps you top of mind and tightens their timeline, with the pipeline board updated straight after.",
  steps: [
    { label: "Set the tone", line: "(Depending on their situation discuss one of the topics below. Make it sound like an easy call for the vendor. Don't over sales pitch it.)" },
    { label: "Reason 1", line: "Buyer call: show stock." },
    { label: "Reason 2", line: "Inform them of a recent sale or listing in their area (doesn't have to be ours)." },
    { label: "Reason 3", line: "Discuss a market place statistic." },
    { label: "Reason 4", line: "Invite to an open house or in room auction." },
    { label: "Reason 5", line: "Inform them that you are sending them our recent market place news update." },
    { label: "Reason 6", line: "Is there anything else we can help them with?" },
    { label: "The buyer line", line: "Mr and Mrs Vendor, we are currently working with a buyer who has recently missed out on another property in your area. They are a cash buyer. Would you be happy for me to mention your property? Or would you prefer me to sell them something else?" }
  ],
  tips: [
    "Jess's contact key: 0 to 2 months, weekly. 2 to 12 months, monthly. Diary it so the call happens without thinking.",
    "One reason per call. Six reasons means six weeks of calls that each feel new.",
    "The buyer line is the tightener: 'mention your property' and 'sell them something else' both get a real answer about timing. Only use it with a real buyer.",
    "Every pipeline seller is a future appraisal and a future listing. After the call, update the board (Trello or the office CRM) before you dial the next one."
  ],
  source: "client-connections--prospecting-call-scripts.md"
},
{
  id: "pipeline-2-12-month-call",
  title: "2 to 12 month pipeline call",
  category: "Pipeline",
  when: "Monthly, to every seller who has said they will move in the next two to twelve months.",
  goal: "Stay useful until the timing tightens: understand what they will buy, get them through some stock, and keep the record live.",
  steps: [
    { label: "If they are looking to re-purchase", line: "Discuss their buying needs." },
    { label: "Book a time to view stock", line: "Book a time to view stock. Great traffic source." },
    { label: "If no stock to view", line: "Mention you still have them in mind. Is there anything else I can help out with at this time?" },
    { label: "If they are relocating", line: "Offer our services as a referral in the area they are moving to." },
    { label: "The buyer line", line: "Mr and Mrs Vendor, we are currently working with a buyer who has recently missed out on another property in your area. They are a cash buyer. Would you be happy for me to mention your property? Or would you prefer me to sell them something else?" }
  ],
  tips: [
    "Monthly is the minimum. A seller who hears from you every month for ten months knows who to call. One who hears from you twice calls whoever rang last.",
    "Viewing stock does two jobs: it keeps a buyer warm and it quietly re-sets the seller's expectations against the real market.",
    "Relocating sellers: a referral to an agent in the area they are moving to is service they will remember, and a listing we would otherwise lose to 'we'll sort it when we get there'.",
    "After the call, update the board. If the timing has moved inside two months, move the card and switch to weekly."
  ],
  source: "client-connections--prospecting-call-scripts.md"
},
{
  id: "traffic-call-buyer",
  title: "Traffic call (buyer follow-up)",
  category: "Buyers",
  when: "The day after a buyer enquires on or inspects one of our listings, and again whenever you have a few new properties to show.",
  goal: "Either a buyer booked onto a 30-minute viewing run with a clear brief, or a buyer who has already bought and is now a record in the database.",
  steps: [
    { label: "Greet", line: "Hi Mr Buyer, it's (your name) from Ray White Mildura." },
    { label: "Reason", line: "Just following up from a property you enquired on / viewed at (address)." },
    { label: "If already purchased", line: "(Confirm details and add to database.)" },
    { label: "Qualify", line: "I am following up to see what exactly you are looking for. Beds, cars, land etc." },
    { label: "Book the run", line: "Great. If I can get 30 mins of your time on (day) or (day), I will put together a couple of properties that fit that criteria and see what you think." },
    { label: "On the day", line: "Mr Buyer, today we will look at 3 to 4 homes. Some may fit your criteria, some may not, but once we finish I will get a great idea of what you are looking for in a property (kitchen, style etc)." }
  ],
  tips: [
    "A buyer who 'already bought' is not a dead call. Confirm the address: they now own a home in someone's farm, maybe yours, and they are a future seller.",
    "Every buyer you qualify properly is a buyer you can honestly mention on your pipeline calls: 'I have a buyer looking in and around your area'.",
    "Ask what they are looking for, write it down, and say it back. The 30-minute run is where the real brief comes out.",
    "Buyers who miss out are the fuel for Just Sold calls: two disappointed buyers is the reason to knock 50 doors."
  ],
  source: "client-connections--prospecting-call-scripts.md"
},
{
  id: "front-door-script",
  title: "The front door script (15-minute appraisal)",
  category: "Appraisal",
  when: "Dropping the market report to someone you spoke to on the phone this week, and turning the drop into a 15-minute kerbside or walk-through appraisal on the spot.",
  goal: "A conservative value range delivered face to face in 15 minutes, a reason to keep in touch, and the home booked into next year's re-appraisal batch.",
  steps: [
    { label: "Greet and reason", line: "Hi Josh. We briefly spoke on the phone this week. Just dropping the market report to you as discussed." },
    { label: "Offer", line: "Would you also be interested in a quick update of your home's value based on comparative sales in your area?" },
    { label: "Two ways", line: "Two ways to do this. 1. I can provide a kerbside appraisal from here based on other recent sales in the area. 2. I have a really quick walk through which will give me some additional information and I can send you a quick summary report along with a list of sales in the immediate area." },
    { label: "Keep to time", line: "I just have another appointment in 20 mins so I will need to keep to time if that's ok." },
    { label: "The estimate", line: "Based on what I can very quickly see and thinking about recent sales in the area, I would estimate the value of your home is between $(low) and $(high). That's a conservative estimate and in the current market, with the right marketing campaign, you might even achieve above that." },
    { label: "Keep in touch", line: "I'll keep in touch. One day in the future, if you get serious about selling, we would need to come back and do a full walk through assessment to determine a current and accurate valuation. So please reach out if that comes to pass." },
    { label: "Close", line: "Otherwise, if you need anything please give me a buzz." }
  ],
  tips: [
    "This is the engine of your 30. Separate the appraisal from the listing presentation: you are here to be their agent before they need an agent, not to win a listing today.",
    "Office guidance: prepare before you knock with three or four comparable sales in the street or suburb, printed. The range comes from them, and a conservative range protects you and the owner. For your first appraisals, run the range past Damian or Luke before you knock.",
    "The 20-minute line is real, so book your drops back to back. Speed dating your prospects is the point; focus on the relationship, not the price.",
    "Before you leave: fill in the Market Update Appraisal form, send the 2-hour SMS, and put the home on the 12-month re-appraisal plan. That is next year's batch building itself."
  ],
  source: "15-minute-appraisal--workbook-the-15-minute-appraisal.md"
},
{
  id: "touch-point-in-person",
  title: "Pipeline touch point (in person)",
  category: "Pipeline",
  when: "A scheduled in-person touch for a pipeline seller when you are in their area anyway, with the latest market report in your hand.",
  goal: "Value handed over, timeline tightened with the buyer line, and the pipeline board updated before you drive off.",
  steps: [
    { label: "Greet", line: "Hey Josh, (your name) from Ray White Mildura." },
    { label: "Offer value", line: "I was in the area and I just wanted to hand you a copy of our latest market report. As you'll see in the report there is good activity in the market at present with some really good results in your area across the last quarter." },
    { label: "Tighten timeline", line: "BTW, based on where you are up to, I have a buyer who is looking in and around your area at the moment. Would you like me to mention your property, or would you prefer me to sell them something else?" },
    { label: "Action after the visit", line: "(Update the pipeline board: Trello or the office CRM. Note what they said about timing.)" }
  ],
  tips: [
    "Jess's post-call action is one line: update the Trello board. Do it in the car, not at the end of the day.",
    "'I was in the area' is only true if you planned the route. Stack pipeline drops with your door knocking and market report drops so one trip does three jobs.",
    "Say what is actually in the report. If results in their street were soft, say so; honesty is the value.",
    "An in-person touch is worth more than a call for the 0 to 2 month group. Make at least one of their weekly touches face to face."
  ],
  source: "sales-is-a-contact-sport--workbook.md"
},
{
  id: "touch-point-phone",
  title: "Pipeline touch point (phone)",
  category: "Pipeline",
  when: "A scheduled phone touch for a pipeline seller, using a new listing nearby as the reason to call.",
  goal: "A reason to call now, a reason to call again when it sells, and the buyer line asked.",
  steps: [
    { label: "Greet", line: "Hey Josh, (your name) from Ray White Mildura." },
    { label: "Offer value", line: "Just touching base today to let you know there has been a new listing down the road at (address)." },
    { label: "Set up next contact", line: "It's currently on the market at $(price). I thought that might interest you, and I'll give you a call back when it sells, and I'll tell you what it makes." },
    { label: "Tighten timeline", line: "BTW, based on where you are up to, I have a buyer who is looking in and around your area at the moment. Would you like me to mention your property, or would you prefer me to sell them something else?" },
    { label: "Action after the call", line: "(Update the pipeline board: Trello or the office CRM.)" }
  ],
  tips: [
    "One listing gives you two calls: when it lists and when it sells. Diary the second call the moment you hang up from the first.",
    "The listing does not have to be ours. Watch the boards in every pipeline seller's street.",
    "Keep it short. This is a touch, not a pitch. Value, next contact, buyer line, done.",
    "Say the price only if it is public (advertised or on the portal). If it is not, say it is on the market and you will tell them what it makes."
  ],
  source: "sales-is-a-contact-sport--workbook.md"
},
{
  id: "tighten-timeline-buyer-line",
  title: "The tighten-timeline buyer line",
  category: "Pipeline",
  when: "The last 15 seconds of any pipeline touch, 2 to 12 month pipeline call or appraisal follow-up where you genuinely have a buyer for their area.",
  goal: "A straight answer about timing: 'mention it' means they are closer than they said, 'sell them something else' tells you where they really sit.",
  steps: [
    { label: "Bridge", line: "BTW, based on where you are up to," },
    { label: "The buyer", line: "I have a buyer who is looking in and around your area at the moment." },
    { label: "Either / or", line: "Would you like me to mention your property, or would you prefer me to sell them something else?" },
    { label: "Variant (from the prospecting call scripts)", line: "We are currently working with a buyer who has recently missed out on another property in your area. They are a cash buyer. Would you be happy for me to mention your property? Or would you prefer me to sell them something else?" }
  ],
  tips: [
    "Both answers are useful. 'Mention it' is a soft yes to an appraisal; 'sell them something else' is permission to keep calling monthly.",
    "Only ever say it when it is true. Check the office buyer list before the session; a made-up buyer costs you the trust the whole pipeline runs on.",
    "Say it as an afterthought, exactly as written: 'BTW'. The lightness is what makes it work.",
    "If they say 'mention it', go straight to the 2 Minute Rule close: Does 2pm or 4pm suit?"
  ],
  source: "sales-is-a-contact-sport--workbook.md"
},
{
  id: "monthly-video-script",
  title: "The monthly video script",
  category: "Video",
  when: "Once a month, filmed in one take on your phone and sent to your whole database and farm by SMS, email or the CRM.",
  goal: "A short monthly update with real numbers that keeps every one of your 300 contacts hearing your voice between calls.",
  steps: [
    { label: "Greet", line: "Hi, it's (your name) here from Ray White Mildura, back today with our monthly market update." },
    { label: "Sales activity", line: "In sales activity, over the past 4 weeks we've seen (number) sales in the (postcode) postcode and a couple of highlights have been (address A) which sold at ($) and (address B) which sold at ($). Here in our office, we have had (number) sales in the last month and on average (number) people attended our open inspections through the month." },
    { label: "Price", line: "Latest updates on the median price shows a (percent) increase in our market over the last quarter, showing we are currently in a rising market. If you are thinking of selling, now could be a great time to have a chat with us to obtain an updated market valuation." },
    { label: "New listings", line: "A quick update on new listings coming to market this month. We see (address) coming up for auction this month. A great (about property). We also see (address) coming to the market this month. A great (about property)." },
    { label: "Community", line: "On the community front, this month we see (local event) on the (date) and also (local event) coming up on the (date). Two great local events in (month) in our community to support and get behind." },
    { label: "Offer", line: "As always, for all your real estate needs, feel free to reach out to me on (your mobile). Until next month, it's (your name)." }
  ],
  tips: [
    "Every number must be real and checked: office sales, median, open home numbers. If the median fell, say it fell and change the 'rising market' line to match. Never read a figure you cannot source.",
    "Only name sold prices that are public. Ask Damian or Luke which results the office is happy to quote.",
    "Community beat: pick two things actually on in Mildura that month (a school fete, the show, a footy final, something on the river). It is the beat people remember.",
    "Fix a filming day and time each month. Jess's rule for video: done beats perfect."
  ],
  source: "client-connections--the-client-connection-model-interactive.md"
},
{
  id: "market-update-video-script",
  title: "The 60-second market update video",
  category: "Video",
  when: "Weekly, filmed on your phone for one lead or one group (skeptics, audience or advocates), and whenever a 30-day amplifier calls for a video.",
  goal: "A personal video under sixty seconds, talking to one person, sent the same day.",
  steps: [
    { label: "Greet", line: "Hi (name), it's (your name) with a quick market update for (suburb)." },
    { label: "The numbers", line: "This week we saw (number) sales, and (number) people through our open homes." },
    { label: "One thing that stood out", line: "(One thing that stood out: a result, a price, a change in buyers.)" },
    { label: "Next step", line: "Hope your week is going well. If you'd like to take the next step, (book a time / reply here)." }
  ],
  tips: [
    "Jess's six steps: draft the script with Claude or ChatGPT, ask for it as four bullet points, open VideoAsk (iPhone) or BigVU (Android), paste the bullets on screen, press record and talk to the points in one take, share the link by SMS, email or the CRM.",
    "Under sixty seconds. Talk to one person, not a crowd. Good light, quiet room, phone at eye level.",
    "The next step changes with the group: for a skeptic there is no ask, just 'reply here'; for an advocate it is 'book a time'.",
    "Done beats perfect. Send the first one this week, and diary the day and time you film every week after."
  ],
  source: "30-day-lead-amplifier--the-30-day-lead-amplifier-workbook.md"
},
{
  id: "give-ask-lines",
  title: "Give and ask lines by lead group",
  category: "Pipeline",
  when: "Before any call, video or visit to a listing lead: decide if they are a skeptic (cold), audience (warm) or advocate (hot), then give or ask accordingly.",
  goal: "Every lead hears the right thing for their trust level: value only for skeptics, give then a soft ask for audience, a clear ask for advocates.",
  steps: [
    { label: "The rule", line: "You do not ask a stranger for the keys. Give to the leads who do not trust you yet. Ask the ones who do." },
    { label: "Skeptics: give", line: "Market update, how to choose an agent, what an agent does for the fee, a recent result." },
    { label: "Skeptics: ask", line: "Nothing yet. Let them come to you." },
    { label: "Skeptic calls in the 30 days", line: "Day 1: Call. Thank them for coming through. Day 28: Call. Share a recent sale near them." },
    { label: "Audience: give, then ask", line: "Give: Education and proof first. A personal video. Something that answers their fear. One of your preferred partners. Ask: A short catch up at the property." },
    { label: "Audience calls in the 30 days", line: "Day 1: Call. What has them thinking about selling? Day 21: Call. Offer to walk through the home. Day 28: Call. Ask for the appraisal." },
    { label: "Advocates: ask", line: "Give: A thank you, a quick update, your preferred partners, a reason to call. Ask: The appraisal date. The listing. Who else they know who is thinking of selling." },
    { label: "Advocate calls in the 30 days", line: "Day 1: Call. Book the appraisal. Day 7: Call. Answer any questions. Day 15: Call. Ask for the listing. Day 25: Call. Ask who else is thinking of selling." },
    { label: "The advocate video ask", line: "We just sold (address) for (result). Buyers are still looking in your area. Let's catch up this week." },
    { label: "Office wording: a skeptic day 1 call", line: "Hi Josh, it's (your name) from Ray White Mildura. Thanks for coming through (address) on the weekend. No pitch, I just wanted to say thanks and see if you had any questions about the home or the area." },
    { label: "Office wording: an audience day 28 call", line: "Hi Josh, (your name) from Ray White Mildura. You mentioned you were thinking about a move next year. Would it help to know roughly where the place sits in today's market? It takes 15 minutes and there's no obligation. Does Wednesday or Friday suit?" },
    { label: "Office wording: an advocate day 15 call", line: "Hi Josh, (your name) here. You've had the appraisal and the presentation tips. I'd love to look after the sale for you. Shall we lock in a launch date?" }
  ],
  tips: [
    "The give and ask lists and the day-by-day calls are Jess's. The three sentences labelled 'office wording' are ours; make them sound like you.",
    "As a new associate most of your leads are skeptics. That is fine: Jess says the top two groups, skeptics and audience, are where the listings are won and lost, and giving is a skill you can practise from day one.",
    "Every open home visitor, every door that answers and every geo data call is a skeptic until they ring you back. Load them into the skeptic amplifier the day you meet them.",
    "Keep the order: give first, ask last. The appraisal (your 30) is the ask for audience; the listing (your 3) is the ask for advocates."
  ],
  source: "30-day-lead-amplifier--the-30-day-lead-amplifier-workbook.md"
},
{
  id: "just-listed-door-knock",
  title: "Just Listed door knock",
  category: "Listing Advantage",
  when: "In the days after the Just Listed letter lands and before the property goes live, knock the neighbours around every new office listing.",
  goal: "Every neighbour knows about the listing, is invited to the VIP neighbours inspection, and is in the CRM as geo data with a reason to hear from you again.",
  steps: [
    { label: "Greet", line: "Hey Josh, I'm (your name) from Ray White Mildura." },
    { label: "Reason", line: "Dropping by today, you may have received a letter in your mailbox a few days ago." },
    { label: "Courtesy notice", line: "As a courtesy on behalf of the vendors at (address), we are just making all neighbours aware that their home is on the market for sale and you may notice over the coming weeks an increase in traffic in the area." },
    { label: "Invite", line: "In addition, I'd love to invite you along to our upcoming VIP neighbours inspection prior to the property going live to the market this coming (day) at (time)." },
    { label: "Welcome", line: "We would love to welcome you along." },
    { label: "Then (office add-on)", line: "(Ask for a name and best number so you can confirm the VIP time, and add them to the CRM. That is one piece of geo data per door.)" }
  ],
  tips: [
    "This is the warmest door knock in real estate: you have a reason, a letter has gone first, and you are giving an invitation, not asking for anything.",
    "The listing does not need to be yours. Ask Damian or Luke which new office listings you can knock around this week.",
    "Aim for the 50 closest homes. The Listing Advantage goal is to turn every listing into one or two new listings, and the neighbours are where they come from.",
    "Log it on the Listing Advantage Snapshot: tick Door knock under Listed, then record appraisals, pipeline leads and database records for the week."
  ],
  source: "listing-advantage--workbook.md"
},
{
  id: "just-listed-phone",
  title: "Just Listed phone call",
  category: "Listing Advantage",
  when: "The same week as the Just Listed door knock, for every neighbour you have a number for and every door that did not answer.",
  goal: "Every neighbour with a phone number hears about the listing and the VIP inspection, and the record is confirmed while you have them.",
  steps: [
    { label: "Greet", line: "Hi Josh, it's (your name) from Ray White Mildura here." },
    { label: "Reason", line: "Just a quick call, you may have received a letter in your mailbox a few days ago." },
    { label: "Courtesy notice", line: "As a courtesy on behalf of the vendors at (address), we are just making all neighbours aware that their home is on the market for sale and you may notice over the coming weeks an increase in traffic in the area." },
    { label: "Invite", line: "In addition, I'd love to invite you along to our upcoming VIP neighbours inspection prior to the property going live to the market this coming (day) at (time)." },
    { label: "Welcome", line: "We would love to welcome you along." },
    { label: "Then (office add-on)", line: "(Confirm name, address, phone and email. Ask if they would like the result when it sells, and diary that call.)" }
  ],
  tips: [
    "Phone and door together cover the whole street: knock in the afternoon, call the no-answers and the known numbers in the next morning session.",
    "A 'yes' to the VIP inspection is a face-to-face meeting with a neighbour on your terms. Treat it as the start of a 15-minute appraisal conversation.",
    "This call and the Magic 50 are cousins. If you have already made the Magic 50 call on this listing, lead with the VIP invitation instead of repeating the traffic line.",
    "Diary the Just Sold call now. The same list gets a second call when the property sells."
  ],
  source: "listing-advantage--workbook.md"
},
{
  id: "just-sold-door-knock",
  title: "Just Sold door knock",
  category: "Listing Advantage",
  when: "Within a week of any office sale, knock the neighbours with the result and the buyers who missed out.",
  goal: "A seller lead or an appraisal booked from the street, and every neighbour's details confirmed in the CRM.",
  steps: [
    { label: "Greet", line: "Hi Josh, I'm (your name) from Ray White Mildura." },
    { label: "The result", line: "Just dropping by today to let you know that we had an excellent result at (address). The home has now gone on and sold for $(price)." },
    { label: "The real reason", line: "The main reason I dropped by today is we had 2 people who viewed the home who were unsuccessful and have kindly asked me if I would drop by all the neighbours in the area to see if anyone else may be looking to sell." },
    { label: "The buyers", line: "These buyers are cashed up, financed, approved and ready to make an offer on the ideal property." },
    { label: "The ask", line: "Would you happen to know of anyone in the area who may be thinking of selling?" },
    { label: "If no", line: "All the best. If you have any real estate needs at any time, feel free to give us a call." },
    { label: "If yes", line: "(Arrange a time to give an appraisal. Does Wednesday or Friday suit?)" }
  ],
  tips: [
    "Say the price only if the vendor and buyer are happy for it to be shared. If not, 'an excellent result' is enough; check with the listing agent first.",
    "'2 people who missed out' must be true. Get the under-bidder count from the listing agent before you knock; it changes with every sale.",
    "'Anyone in the area' includes them. Plenty of owners answer 'well, we might be' to that question. Pause after you ask it.",
    "Every door, yes or no, is a details check and a piece of geo data. The Just Sold knock is often the biggest geo data day of the week."
  ],
  source: "listing-advantage--workbook.md"
},
{
  id: "just-sold-phone",
  title: "Just Sold phone call",
  category: "Listing Advantage",
  when: "The same week as the Just Sold door knock, for every neighbour with a number, and the callback you promised on the Just Listed or Magic 50 call.",
  goal: "The promised result delivered, a seller lead asked for, and an appraisal booked where there is one.",
  steps: [
    { label: "Greet", line: "Hi Josh, (your name) from Ray White Mildura here." },
    { label: "The result", line: "Just a quick call today to let you know that we had an excellent result at (address). The home has now gone on and sold for $(price)." },
    { label: "The real reason", line: "The main reason I called today is we had 2 people who viewed the home who were unsuccessful and have kindly asked me if I would drop by all the neighbours in the area to see if anyone else may be looking to sell." },
    { label: "The buyers", line: "These buyers are cashed up, financed, approved and ready to make an offer on the ideal property." },
    { label: "The ask", line: "Would you happen to know of anyone in the area who may be thinking of selling?" },
    { label: "If no", line: "All the best. If you have any real estate needs at any time, feel free to give us a call." },
    { label: "If yes", line: "(Arrange a time to give an appraisal. Does Wednesday or Friday suit?)" }
  ],
  tips: [
    "If you promised 'I will let you know the result when it sells', this is the call that keeps the promise. Kept promises are what make the next call welcome.",
    "The under-bidders are real people with a real brief. Know roughly what they want so you can answer 'what are they after?' honestly.",
    "A 'no' still earns a details check and a note. A 'maybe' gets two times offered and goes on the pipeline list today.",
    "Track it on the Listing Advantage Snapshot: calls made, appraisals booked, pipeline leads, database records. One listing should produce one or two more."
  ],
  source: "listing-advantage--workbook.md"
},
{
  id: "buyers-post-sale-call",
  title: "Buyers post-sale call",
  category: "Buyers",
  when: "After a property sells, call everyone who inspected it and did not buy.",
  goal: "A seller lead from the buyer's network, a clear picture of where their search is up to, and the appraisal opportunity revisited if they have a home to sell.",
  steps: [
    { label: "Greet and reason", line: "Hi (name), calling today to inform you that (address), a home that you viewed with us a few weeks back, has now gone on and sold." },
    { label: "The result", line: "It sold for $(price), a great result." },
    { label: "The buyers", line: "We have two buyers who have inspected that are still interested in purchasing in the immediate area." },
    { label: "The ask", line: "Are you aware of anyone who may be considering selling?" },
    { label: "Their search", line: "Where are you up to in your search for the ideal home?" },
    { label: "Revisit", line: "(Revisit the appraisal opportunity from the initial OFI callback: do they still have a home to sell first?)" }
  ],
  tips: [
    "Buyers who missed out are warm, slightly disappointed and grateful for a call. Most agents never ring them.",
    "A buyer with a home to sell is a seller. If the OFI callback flagged 'upsize or downsize', this is the call to book the appraisal: Does Wednesday or Friday suit?",
    "Update the buyer's brief while you have them. A qualified buyer is what makes your tighten-timeline line honest on tomorrow's pipeline calls.",
    "Price only if it is public. Otherwise 'a great result' and move on to the ask."
  ],
  source: "listing-advantage--workbook.md"
},
{
  id: "ofi-callback",
  title: "OFI callback questions",
  category: "Buyers",
  when: "The Monday after every open home, call everyone who came through, on behalf of the owners.",
  goal: "Feedback for the vendor, every visitor sorted into appraisal, pipeline or database, a seller referral asked for, and a broker referral where it fits.",
  steps: [
    { label: "Introduction", line: "Hi Mr Buyer, my name is (your name) from Ray White Mildura. I won't take too much of your time today. This is just a courtesy call on behalf of the owners of (address) to gather some thoughts on your recent inspection." },
    { label: "Appraisal opportunity", line: "First, may I ask, are you looking to downsize or upsize your current property?" },
    { label: "If yes", line: "Let's make a time that suits next week and I will call past and provide you with an estimate of what you could achieve in the current market. Would Wednesday or Friday suit? (If they are a next 12 month seller, add them into your pipeline list.)" },
    { label: "Database opportunity (if no)", line: "We send a quarterly market update. If I could get your address I will have one sent out next week for you. Also, if I could get your email address I will send it there to make it easier next time." },
    { label: "Property feedback", line: "What did you think of (address)? Did you like the view? Did you like the kitchen? (Prompt questions, positive and negative. Goal: either an offer or price feedback.)" },
    { label: "Other sellers in the area", line: "Lastly, before I let you go today, do you know of anyone else who is considering selling? You don't know of anyone else who has tried to sell and hasn't had any luck?" },
    { label: "Finance, option 1", line: "May I ask, have you spoken to the bank yet? (If no, go to the broker line. If yes:) Was that directly or through a broker?" },
    { label: "Finance, option 2", line: "May I ask, are you a first home buyer, home owner or investor?" },
    { label: "The broker line", line: "The reason I ask is that we have a major mortgage broker group working closely with our business to try and save people money when they finance their home. They have access to over 30 lenders as well. Best of all it's a no obligation, free consultation. The banks pay them for the business they write, and we share the commissions amongst us through a referral fee. I recommend them as they have a professional, responsive team in our area. I would encourage you to talk to them, and would like to pass on your details to the team. Is that ok?" }
  ],
  tips: [
    "Ask the appraisal question first, before feedback. Every open home visitor is a possible seller, and this is where a good share of your 30 appraisals comes from.",
    "A 'no' still gives you an address and an email: that is a piece of geo data from every call.",
    "Before you use the finance beat, confirm with Damian or Luke which broker we work with, how many lenders they really have and how the referral fee is disclosed. Say the real numbers, not Jess's sample.",
    "Feedback goes to the vendor the same day. The callback is on their behalf, so report what you heard, good and bad."
  ],
  source: "listing-advantage--ofi-callback-question.md"
},
{
  id: "objection-handlers",
  title: "Objection handlers (office guidance)",
  category: "Prospecting",
  when: "Any time a prospecting call or door knock hits a wall: answer with courtesy, give value first, and leave the door open.",
  goal: "Either details in the CRM, a time in the diary, or a clean exit that means you can call again next quarter.",
  steps: [
    { label: "Not interested", line: "No worries, and thanks for being upfront. Most people I speak to aren't selling, that's not why I'm calling. I'm sending the (lead magnet) to a few homes in (street) so you know what places are going for, can I pop one in the mail for you?" },
    { label: "I already have an agent", line: "That's great, it's good to have someone in your corner, and I'm not asking you to change anything. I'll send the market update so you have a second set of numbers when the time comes. What's the best address for it?" },
    { label: "How did you get my number?", line: "Fair question: (say exactly how, you met at the door, they came through an open home, or they are on the office database). I'm calling to introduce myself as the Ray White Mildura person for your street, and if you'd rather I didn't call again, just say so and I'll note it now. Otherwise, would it be okay to send you the market update?" },
    { label: "What's it worth?", line: "Good question, and I'd only be guessing from here. Give me 15 minutes at the place and I'll give you a conservative range based on what has actually sold around you, no obligation and no pressure to sell. Does Wednesday or Friday suit?" },
    { label: "Just send me something", line: "Happy to, I'll have the (lead magnet) to you this week. Can I grab the best address and a mobile so I can check it arrived? I'll be in (street) next week dropping a few off, so I'll say a quick hello then too." },
    { label: "We're not selling", line: "That's fine, most people I speak to aren't, and I'm not calling to sell your home. I like to know the owners in (area) before they ever need an agent, so if I can grab your details I'll keep you posted on what sells nearby. Is there anything in the next 12 months I can help with?" },
    { label: "I'm busy", line: "Of course, I'll be quick, I'm only calling to send you the (lead magnet). Can I grab your address and I'll let you go? Or would 2pm or 4pm tomorrow be a better time?" },
    { label: "Take me off your list", line: "No problem at all, I'll do that now, and I'm sorry for the interruption. If you ever need anything in real estate, I'm (your name) at Ray White Mildura. Have a good day." }
  ],
  tips: [
    "These responses are office guidance, not Jess's words. The principles are hers: never burn your bridges with a prospect, and remember that the rejection you experience has nothing to do with you personally.",
    "Value first, every time. The lead magnet, the market update and the 15-minute appraisal are what you offer; you are never asking them to sell.",
    "Offer two times, not an open question. Wednesday or Friday, 2pm or 4pm.",
    "'Take me off your list' means exactly that: mark the record do-not-call in the CRM before the next dial and follow the office do-not-call process. One kept promise protects the whole farm."
  ],
  source: "client-connections--prospecting-call-scripts.md"
}
);
