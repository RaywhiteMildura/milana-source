window.LAUNCHPAD_CONTENT = window.LAUNCHPAD_CONTENT || { weeks: [], scripts: [], templates: [], rolePlays: [] };

// Launchpad 300.30.3 - spoken scripts library for Ray White Mildura.
// Words in brackets are placeholders: swap in the real name, address or number before you say the line.

window.LAUNCHPAD_CONTENT.scripts.push(
{
  id: "farm-intro-phone",
  title: "Farm Introduction script (phone)",
  category: "Prospecting",
  when: "Every first call to an owner in your farm area. This is the call that turns a name on a list into a piece of geo data.",
  goal: "A name, address and phone number (and an email if you can) ready for the CRM, plus a straight answer about the next 12 months.",
  steps: [
    { label: "Introduce", line: "Hi (name), it's (your name) calling from Ray White Mildura." },
    { label: "Reason", line: "I'm giving you a quick ring about (lead magnet). We've been sending it to homes around you and people tell us they really like it. It shows what's selling nearby and how the local market is going." },
    { label: "Offer", line: "I'd be happy to send you a copy as well. Can I just check a couple of details?" },
    { label: "Collect details", line: "(Note their name, address and phone number. Ask for an email too, so the update can reach them both ways.)" },
    { label: "The 12-month question", line: "And while I've got you, is anything happening with property for you over the next 12 months that we could help with?" },
    { label: "Next steps", line: "Thanks so much. I'll get the (lead magnet) out to you in the next few days." }
  ],
  tips: [
    "Know your lead magnet before you dial. What is it, what's inside, and why would a neighbour want it? Have a copy in front of you.",
    "A finished call with name, address and phone (or email) in the CRM is one of your 300. Prepare 30 names before every session. No computer, just a notepad.",
    "The session benchmark is 18 to 24 calls, 8 to 12 connections and 1 to 3 appointments in 45 minutes. Cross each name off the call sheet as you go.",
    "A yes to the 12-month question gets a note in the CRM today and an offer of a Doorstep Appraisal on the spot: Does 2pm or 4pm suit? Once you've appraised the home, it goes on your pipeline."
  ]
},
{
  id: "farm-intro-door",
  title: "Farm Introduction script (door)",
  category: "Prospecting",
  when: "Door knocking your farm area with one copy of the lead magnet in your hand and the rest left in the car.",
  goal: "A name and phone number (and an email) to go with the address you're standing at, plus a straight answer about the next 12 months.",
  steps: [
    { label: "Introduce", line: "Hi (name), I'm (your name) from Ray White Mildura." },
    { label: "Reason", line: "I'm just popping round about (lead magnet). We've been sending it to homes around you and people tell us they really like it. It shows what's selling nearby and how the local market is going." },
    { label: "Offer", line: "I've only got the one with me today. If I grab a few details, I'll make sure a copy comes to you." },
    { label: "Collect details", line: "(Note their name and phone number. You already have the address. Ask for an email too.)" },
    { label: "The 12-month question", line: "And while I'm here, is anything happening with property for you over the next 12 months that we could help with?" },
    { label: "Next steps", line: "Thanks so much. I'll get the (lead magnet) out to you in the next few days." }
  ],
  tips: [
    "Carry one copy only. Showing it without handing it over is what makes the swap feel natural: they get theirs in the mail, and you get a record.",
    "You usually won't know the name at the door. Open with 'Hi there' and ask for their name when you take details. You already have the address, so one phone number makes it a piece of geo data.",
    "Knock in daylight. Step back from the door and smile before it opens. No answer? Note the address, try again at a different time of day, and ring the number if the office database has one.",
    "Work the door and the phone together. Knock a street in the afternoon, then call the numbers you collected in the next morning's session."
  ]
},
{
  id: "two-minute-close",
  title: "The Two-Minute Close",
  category: "Prospecting",
  when: "Any call that goes past two minutes. It's going well, so book a meeting instead of talking on.",
  goal: "A day and a time in the diary, booked before the call wanders.",
  steps: [
    { label: "Wrap up warmly", line: "I've really enjoyed this chat. I've got another appointment shortly, though." },
    { label: "Give the reason", line: "I'm around your way a few times over the next couple of days, catching up with some of your neighbours." },
    { label: "Invite", line: "It'd be good to pop in and pick up where we left off." },
    { label: "Offer two times", line: "Does 2pm or 4pm suit?" }
  ],
  tips: [
    "The program's rule: once a call reaches two minutes, stop chatting and start closing for a time to meet.",
    "Give two options, not an open question. 'When suits?' gets 'I'll let you know'. '2pm or 4pm?' gets a time.",
    "The meeting is usually a market report drop that turns into a Doorstep Appraisal. Each one moves you closer to your 30.",
    "If neither time works, offer two more. Still no? Book the next call instead and move on. Keep the session moving."
  ]
},
{
  id: "fifty-neighbours",
  title: "Fifty Neighbours calls",
  category: "Prospecting",
  when: "Within days of any listing or sale near your farm (ours or another agency's), call the 50 nearest homes.",
  goal: "Fresh details on 50 neighbours, a yes from each to a callback when it sells, and at least one name of someone who might be selling.",
  steps: [
    { label: "Greet and build rapport", line: "Hi, it's (your name) from Ray White Mildura. (A little small talk first.)" },
    { label: "Courtesy reason", line: "I'm calling as a courtesy. (Address) near you has just been listed / has been listed by another agency / has just sold. (For a new listing, add:) We're letting the neighbours know, because you'll likely see extra cars and visitors in the street over the next month." },
    { label: "Offer the result", line: "As a local owner, would you like to know what it ends up selling for? (If it has already sold: would you like to know the price once it's made public?)" },
    { label: "If yes", line: "Great. I'll give you a call once it sells and let you know the result. (If it has already sold: I'll ring you as soon as the price is public.)" },
    { label: "Update details", line: "(Check name, address, phone and email while you have them.)" },
    { label: "Just before I go", line: "One last thing before I let you go. Do you know anyone nearby who might be thinking of selling? We've got a cash buyer keen on this part of town, and they've asked us to ring around the owners here." }
  ],
  tips: [
    "A yes to hearing the result is permission to call again. One listing gives you two touches, and that is how a board in the street turns into geo data and your next appraisal.",
    "It doesn't need to be our listing. Any board in the street is a reason to ring 50 homes.",
    "Only mention a cash buyer if we really have one. Check the office buyer list with Damian or Luke before the session.",
    "Fifty calls is two or three 45-minute sessions at 18 to 24 calls each. Pull the 50 names and numbers the day the board goes up."
  ]
},
{
  id: "quarterly-market-update-call",
  title: "Quarterly market update call",
  category: "Prospecting",
  when: "The week after the quarterly market update goes out to your farm. Call every home that got one.",
  goal: "Every contact's details confirmed, a resend where it went missing, and any 12-month plans noted in the CRM with an appraisal offered.",
  steps: [
    { label: "Greet and build rapport", line: "Hi Mr and Mrs (name), it's (your name) from Ray White Mildura. (A little small talk first.)" },
    { label: "Did it arrive?", line: "Just a quick courtesy call. Did our latest quarterly market update reach you OK? (If not, check their details and send another.)" },
    { label: "Any needs?", line: "Is there anything else property-wise I can help you with this quarter? (Check all their details again.)" },
    { label: "Update details", line: "(Check the record: name, address, phone, email. Fix anything that has changed.)" },
    { label: "Just before I go", line: "One last thing before I let you go. Do you know anyone nearby who might be thinking of selling? We've got a cash buyer keen on this part of town, and they've asked us to ring around the owners here." }
  ],
  tips: [
    "'Did it arrive?' is the easiest question in real estate. It gives you a reason to call and asks nothing of them.",
    "'No, it never came' is good news. You confirm the address, send another, and the record gets cleaned up.",
    "Finish every call with the referral question, and only mention a cash buyer when the office really has one. A single seller name each week from these calls adds up to a month of appraisals over the 12 weeks.",
    "Your Contact Tiers set how many times a year each contact hears from you. A quarterly call to every record is the simplest way to hit that number."
  ]
},
{
  id: "database-call-script",
  title: "The database call script",
  category: "Prospecting",
  when: "Calling warm contacts already in the database (past enquiries, people you've met, the office database) after a newsletter goes out.",
  goal: "A friendly two-minute call that confirms the newsletter arrived, adds one personal note to the record and uncovers any property plans this quarter.",
  steps: [
    { label: "Greet", line: "Hi, it's (your name) from Ray White Mildura." },
    { label: "Quick call", line: "I know you're busy, so I'll keep this short. It's just a quick one." },
    { label: "Received", line: "Our quarterly market update newsletter went out recently. Did yours come through OK? (If not, send it again.)" },
    { label: "Activity", line: "It's been a busy market. There have been (number) sales, and our median price is up (percent), which is good news for owners." },
    { label: "Rapport", line: "How have you all been? Last time we spoke, Billy was just starting footy. How's he finding it?" },
    { label: "Real estate needs", line: "Before I let you go, is there anything property-related I can help with this quarter?" }
  ],
  tips: [
    "'It's just a quick one' lowers their guard. Then keep your word: be off in two minutes unless they want to talk. If they do, use the Two-Minute Close.",
    "The activity line needs real numbers. Get this month's office sales and median from Damian or Luke before the session and write them on your call sheet. Say what the numbers really say, and never quote a figure you can't back up.",
    "The rapport question is why you take notes. Billy and the footy is only the example. Yours comes from the last note in the CRM. No note yet? This call creates one.",
    "The newsletter tells them what's happening in the market. The call is what builds the relationship."
  ]
},
{
  id: "call-toolkit",
  title: "Call toolkit: extenders, appointment setters, enders",
  category: "Prospecting",
  when: "On every call. Extenders keep people talking, setters come out the moment there's a reason to meet, and enders get you off cleanly so the session keeps moving.",
  goal: "You decide how long each call runs and how it ends, and any call worth two minutes finishes with a time in the diary.",
  steps: [
    { label: "Extender", line: "Why's that?" },
    { label: "Extender", line: "Tell me a bit more..." },
    { label: "Extender", line: "What do you mean by that?" },
    { label: "Extender", line: "Mmhm..." },
    { label: "Extender", line: "Right..." },
    { label: "Extender", line: "How can I help with that?" },
    { label: "Appointment setter", line: "So where to from here?" },
    { label: "Appointment setter", line: "What would the next step look like for you?" },
    { label: "Appointment setter", line: "Sounds like we should sit down together." },
    { label: "Appointment setter", line: "Could you do tomorrow at 2pm or 4pm?" },
    { label: "Appointment setter", line: "Given all that, when's a good time to talk again?" },
    { label: "Conversation ender", line: "I know you've got things on, so I'll let you go." },
    { label: "Conversation ender", line: "I've got another appointment to head to now." },
    { label: "Conversation ender", line: "I'm near you on (day) next week. Let's catch up then. Does 2pm or 4pm suit?" }
  ],
  tips: [
    "Extenders are short for a reason. Ask, then stay quiet. The pause after 'Why's that?' is often when people mention they're thinking of selling.",
    "Choose one setter and one ender to own this week. Write them at the top of your daily call sheet.",
    "An ender with a time in it ('Does 2pm or 4pm suit?') is really an appointment setter. Use it on anyone warm.",
    "Pace matters. 18 to 24 calls in 45 minutes leaves no room for ten-minute chats that lead nowhere. Stretch the good calls and end the rest."
  ]
},
{
  id: "pipeline-1-2-month-call",
  title: "1 to 2 month pipeline call",
  category: "Pipeline",
  when: "Weekly, to every seller likely to list in the next one to two months, with one reason to call each time.",
  goal: "A light, useful call that keeps you front of mind and firms up their timing, with the pipeline board updated straight after.",
  steps: [
    { label: "Set the tone", line: "(Choose one of the reasons below to suit where they're at. Keep it light and easy for the owner. No hard sell.)" },
    { label: "Reason 1", line: "Offer to show them a few homes on the market (handy if they're buying again)." },
    { label: "Reason 2", line: "Tell them about a recent sale or new listing near them (it doesn't need to be ours)." },
    { label: "Reason 3", line: "Share one local market figure." },
    { label: "Reason 4", line: "Invite them to an open home or an in-room auction." },
    { label: "Reason 5", line: "Let them know our latest market news update is on its way to them." },
    { label: "Reason 6", line: "Ask if there's anything else we can do for them." },
    { label: "The Timing Question", line: "Mr and Mrs (name), we're working with a cash buyer who just missed out on a home near you. Would you like me to mention your place to them, or should I find them something else?" }
  ],
  tips: [
    "The program's contact rhythm: weekly for sellers 1 to 2 months out, monthly for those 2 to 12 months out. Put it in the diary so the call happens without thinking.",
    "One reason per call. Six reasons gives you six weeks of calls that each feel fresh.",
    "The Timing Question does the firming up. 'Mention it' and 'find them something else' both tell you where their timing really sits. Only ask it when the buyer is real.",
    "Every pipeline seller is a future listing appointment and a future listing. Update the board (Trello or the office CRM) before you dial the next number."
  ]
},
{
  id: "pipeline-2-12-month-call",
  title: "2 to 12 month pipeline call",
  category: "Pipeline",
  when: "Monthly, to every seller who has told you they'll move in the next two to twelve months.",
  goal: "Stay useful until their timing firms up: learn what they'll buy next, get them through some listings, and keep the record current.",
  steps: [
    { label: "If they plan to buy again", line: "Talk through what they'd want in their next home." },
    { label: "Book a viewing", line: "Book a time to show them a few listings. It also puts more buyers through the homes we're selling." },
    { label: "If nothing suits right now", line: "Let them know you're still keeping an eye out for them. Is there anything else I can help with right now?" },
    { label: "If they're moving away", line: "Offer to refer them to a good agent in the town they're moving to." },
    { label: "The Timing Question", line: "Mr and Mrs (name), we're working with a cash buyer who just missed out on a home near you. Would you like me to mention your place to them, or should I find them something else?" }
  ],
  tips: [
    "Monthly is the floor. A seller who hears from you every month for ten months knows who to call. One who hears from you twice calls whoever rang last.",
    "Showing them listings does two jobs. It keeps a buyer warm, and it quietly resets the seller's expectations against what's really out there.",
    "Sellers moving away: a referral to an agent where they're heading is service they'll remember. It also keeps their sale here with us, instead of losing it to 'we'll sort it out once we've moved'.",
    "After the call, update the board. If their timing has moved inside two months, move the card and switch to weekly calls."
  ]
},
{
  id: "traffic-call-buyer",
  title: "Traffic call (buyer follow-up)",
  category: "Buyers",
  when: "The day after a buyer enquires on or inspects one of our listings, and again whenever you have a few new homes to show.",
  goal: "A buyer booked into a 30-minute viewing run with a clear brief, or a buyer who has already bought and is now a record in the database.",
  steps: [
    { label: "Greet", line: "Hi (name), it's (your name) from Ray White Mildura." },
    { label: "Reason", line: "I'm following up on (address), the home you enquired about / came through." },
    { label: "If already purchased", line: "(Congratulate them, confirm their new address and add them to the database.)" },
    { label: "Qualify", line: "I'd love to know exactly what you're after. How many bedrooms, how many car spaces, how much land?" },
    { label: "Book the run", line: "If you can give me half an hour on (day) or (day), I'll line up a few homes that match and we'll see what you think." },
    { label: "On the day", line: "Today we'll see 3 or 4 homes. Some will tick your boxes and some won't, and that's fine. By the end I'll have a much better feel for what you want (kitchen, style and so on)." }
  ],
  tips: [
    "'We've already bought' is not a dead call. Confirm the address: they now own a home in someone's farm, maybe yours, and one day they'll sell.",
    "Every buyer you qualify properly is one you can honestly mention when you ask the Timing Question on pipeline calls.",
    "Ask what they want, write it down and say it back. The 30-minute run is where the real brief comes out.",
    "Buyers who miss out are what make Just Sold calls work. Two disappointed buyers is a reason to knock 50 doors."
  ]
},
{
  id: "doorstep-script",
  title: "The Doorstep Script (Doorstep Appraisal)",
  category: "Appraisal",
  when: "Dropping the market report to someone you spoke to on the phone this week, and turning the drop into a quick kerbside or walk-through appraisal on the spot.",
  goal: "A conservative value range given face to face in about 15 minutes, a reason to stay in touch, and the home set up for its 12-month re-appraisal.",
  steps: [
    { label: "Greet and reason", line: "Hi Josh, it's (your name). We spoke on the phone earlier this week. I've brought the market report I mentioned." },
    { label: "Offer", line: "While I'm here, would it help to get a quick idea of what your home is worth? I'd base it on what's sold nearby." },
    { label: "Two ways", line: "I can do it two ways. One, I give you a kerbside figure from right here, using recent sales around you. Two, I take a quick walk through, which tells me a bit more, and then I send you a short summary with a list of nearby sales." },
    { label: "Keep to time", line: "I've got another appointment in 20 minutes, so I'll keep an eye on the clock, if that's OK." },
    { label: "The estimate", line: "From what I can see, and going by recent sales nearby, I'd put your home somewhere between $(low) and $(high). That's on the conservative side. With the right campaign in this market, you could do better than that." },
    { label: "Keep in touch", line: "I'll stay in touch. If you do decide to sell one day, we'd come back for a proper look through the whole home and give you an up-to-date, accurate figure. Just let me know when that time comes." },
    { label: "Close", line: "In the meantime, if you need anything at all, give me a call." }
  ],
  tips: [
    "This script drives your 30. Keep the appraisal separate from the listing presentation. Today is about earning their trust long before they're ready to sell, not about winning a listing.",
    "Office guidance: before you knock, print three or four comparable sales from the street or suburb. Your range comes from them, and a conservative range protects you and the owner. For your first appraisals, run the range past Damian or Luke first.",
    "The 20-minute line is real, so book your drops back to back. Keep each visit short so you can see more owners. The relationship matters more than the price.",
    "Before you drive off: fill in the Quick Appraisal form, schedule the 2-hours-after SMS, tap + for the appraisal in the app and complete the detail sheet, then add the home to your 12-month re-appraisal plan. That way this year's visits book next year's appraisals for you."
  ]
},
{
  id: "touch-point-in-person",
  title: "Pipeline touch point (in person)",
  category: "Pipeline",
  when: "A planned face-to-face touch with a pipeline seller when you're nearby anyway, with the latest market report in hand.",
  goal: "Something useful handed over, the Timing Question asked, and the pipeline board updated before you drive off.",
  steps: [
    { label: "Greet", line: "Hi Josh, it's (your name) from Ray White Mildura." },
    { label: "Offer value", line: "I was just in the street and wanted to drop off our latest market report. You'll see it's been a busy few months, with some strong results near you last quarter." },
    { label: "The Timing Question", line: "By the way, given where you're at, I've got a buyer looking around this area right now. Would you like me to mention your place, or should I find them something else?" },
    { label: "Action after the visit", line: "(Update the pipeline board: Trello or the office CRM. Note what they said about timing.)" }
  ],
  tips: [
    "There is one job after the visit: update the board. Do it in the car, not at the end of the day.",
    "'I was just in the street' only works if you planned the route. Combine pipeline drops with door knocking and report drops so one trip does three jobs.",
    "Only say what's really in the report. If results in their street were soft, say so. Being straight with them is the value.",
    "Face to face counts for more than a phone call with your 1 to 2 month sellers. Make sure at least one touch each month is a visit."
  ]
},
{
  id: "touch-point-phone",
  title: "Pipeline touch point (phone)",
  category: "Pipeline",
  when: "A planned phone touch with a pipeline seller, using a new listing nearby as the reason to call.",
  goal: "A reason to call now, a reason to call back when it sells, and the Timing Question asked.",
  steps: [
    { label: "Greet", line: "Hi Josh, it's (your name) from Ray White Mildura." },
    { label: "Offer value", line: "Just a quick one to let you know a home has come on the market up the road at (address)." },
    { label: "Set up next contact", line: "It's listed at $(price). I thought you'd want to know, and I'll ring you once it sells to tell you what it got." },
    { label: "The Timing Question", line: "By the way, given where you're at, I've got a buyer looking around this area right now. Would you like me to mention your place, or should I find them something else?" },
    { label: "Action after the call", line: "(Update the pipeline board: Trello or the office CRM.)" }
  ],
  tips: [
    "One listing, two calls: one when it lists and one when it sells. Diary the second call as soon as you hang up.",
    "It doesn't need to be our listing. Watch the boards in every pipeline seller's street.",
    "Keep it short. This is a touch, not a pitch. Value, next call, Timing Question, done.",
    "Only quote the price if it's public (advertised or online). If not, say it's on the market and you'll tell them what it gets."
  ]
},
{
  id: "timing-question-buyer-line",
  title: "The Timing Question",
  category: "Pipeline",
  when: "The last 15 seconds of any pipeline touch, 2 to 12 month call or appraisal follow-up, when you really do have a buyer for their area.",
  goal: "An honest read on timing: 'mention it' means they're closer than they said, and 'find them something else' tells you where they really sit.",
  steps: [
    { label: "Bridge", line: "By the way, given where you're at," },
    { label: "The buyer", line: "I've got a buyer looking around this area right now." },
    { label: "Either / or", line: "Would you like me to mention your place, or should I find them something else?" },
    { label: "Cash buyer version", line: "We're working with a cash buyer who just missed out on a home near you. Would you like me to mention your place to them, or should I find them something else?" }
  ],
  tips: [
    "Both answers help you. 'Mention it' is a soft yes to an appraisal. 'Find them something else' is permission to keep calling monthly.",
    "Only ever say it when it's true. Check the office buyer list before the session. A made-up buyer costs you the trust your whole pipeline runs on.",
    "Drop it in casually, almost as an afterthought: 'By the way...'. The light touch is what makes it work.",
    "If they say 'mention it', go straight to the Two-Minute Close: Does 2pm or 4pm suit?"
  ]
},
{
  id: "monthly-video-script",
  title: "The monthly video script",
  category: "Video",
  when: "Each month, shot in a single take on your phone and sent by SMS, email or the CRM: to everyone you have met until you tier your contacts in week 6, then to your Gold and Platinum contacts.",
  goal: "A short update each month, built on checked local numbers, so your top contacts hear your voice between calls.",
  steps: [
    { label: "Greet", line: "Hi, it's (your name) from Ray White Mildura with this month's market update." },
    { label: "Sales activity", line: "First, sales. In the last 4 weeks there were (number) sales in the (postcode) postcode. Two that stood out were (address A), which sold for ($), and (address B), which sold for ($). Our office had (number) sales this month, and each of our open homes drew an average of (number) people." },
    { label: "Price", line: "The median price is up (percent) on last quarter, so prices are rising here. If you've been thinking about selling, it's a good time to get an up-to-date appraisal. Just give us a call." },
    { label: "New listings", line: "Now some new listings for this month. (Address) goes to auction this month. It's a lovely (about property). (Address) also comes on the market this month. It's a great (about property)." },
    { label: "Community", line: "Around town, (local event) is on the (date) and (local event) is on the (date). Two great local events this (month), so get along and support them." },
    { label: "Offer", line: "If there's anything property-related I can help with, call me on (your mobile). I'm (your name) from Ray White Mildura, and I'll see you next month." }
  ],
  tips: [
    "Every number must be real and checked: office sales, median, open home numbers. If the median fell, say so and change the rising market line to match. Never read out a figure you can't source.",
    "Only name sold prices that are public. Ask Damian or Luke which results the office is happy to quote.",
    "For the community part, pick two things really on in Mildura that month: a school fete, the show, a footy final, something on the river. It's the bit people remember.",
    "Set a filming day and time each month. A video that goes out beats a perfect one that never does."
  ]
},
{
  id: "market-update-video-script",
  title: "The 60-second market update video",
  category: "Video",
  when: "Weekly, filmed on your phone for one lead or one group (cold, warm or hot), and whenever a 30-day trust plan calls for a video.",
  goal: "A personal video under sixty seconds, made for one person, sent the same day.",
  steps: [
    { label: "Greet", line: "Hi (name), (your name) here with a quick update on the (suburb) market." },
    { label: "The numbers", line: "This week there were (number) sales, and (number) people came through our open homes." },
    { label: "One thing that stood out", line: "(One thing worth noticing: a result, a price, a shift in what buyers want.)" },
    { label: "Next step", line: "Hope the week's treating you well. If you're ready for the next step, (book a time / just reply here)." }
  ],
  tips: [
    "The steps: ask Claude or ChatGPT to draft the script, have it boil the script down to four dot points, open a teleprompter app (VideoAsk on iPhone, BigVU on Android), paste the points on screen, record in one take while you talk to them, then send the link by SMS, email or the CRM.",
    "Keep it under sixty seconds. Picture one person and talk just to them. Find good light and a quiet room, and hold the phone at eye level.",
    "Match the next step to the lead. A cold lead gets no ask, just 'reply here'. A hot lead gets 'book a time'.",
    "A sent video beats a perfect one. Send your first this week and diary the day and time you'll film each week after."
  ]
},
{
  id: "cold-warm-hot-lines",
  title: "Give and ask lines by lead group",
  category: "Pipeline",
  when: "Before any call, video or visit to a listing lead, decide if they are cold, warm or hot, then give or ask to match.",
  goal: "Every lead hears the right thing for how much they trust you: value only for cold leads, value then a gentle ask for warm leads, a clear ask for hot leads.",
  steps: [
    { label: "The rule", line: "Nobody hands their keys to a stranger. Give value to people who don't know you yet. Ask the ones who do for the next step." },
    { label: "Cold: give", line: "A market update, a guide to choosing an agent, what you really get for an agent's fee, a recent result." },
    { label: "Cold: ask", line: "Nothing yet. Let them come to you." },
    { label: "Cold lead calls in the 30 days", line: "Day 1: Call to thank them for coming through. Day 28: Call to share a recent sale near them." },
    { label: "Warm: give, then ask", line: "Give: Teach them something and show proof first. A short video made just for them. Something that eases their biggest worry. An introduction to one of your preferred partners. Ask: A short catch up at the property." },
    { label: "Warm lead calls in the 30 days", line: "Day 1: Call and ask what has them thinking about selling. Day 7: Call and help with any questions they have. Day 21: Call and offer a walk through the home. Day 28: Call and ask for the appraisal." },
    { label: "Hot: a little give, a clear ask", line: "Give: Your thanks, a brief update, introductions to your preferred partners, and a fresh reason to talk. Ask: A date for the appraisal. The listing. Who else they know who might sell." },
    { label: "Hot lead calls in the 30 days", line: "Day 1: Call to book the appraisal. Day 15: Call and ask for the listing. Day 25: Call and ask who else they know who might sell." },
    { label: "The hot lead video ask", line: "We've just sold (address) for (result), and there are still buyers looking near you. Can we catch up this week?" },
    { label: "Sample: a cold lead day 1 call", line: "Hi Josh, it's (your name) from Ray White Mildura. Thanks for coming through (address) on the weekend. I'm not calling to sell you anything. I just wanted to say thanks and see if you had any questions about the home or the area." },
    { label: "Sample: a warm lead day 28 call", line: "Hi Josh, (your name) from Ray White Mildura. You mentioned you might be moving next year. Would it help to know roughly where your place sits in today's market? It takes 15 minutes and there's no obligation. Does Wednesday or Friday suit?" },
    { label: "Sample: a hot lead day 15 call", line: "Hi Josh, (your name) here. You've had the appraisal and the presentation tips. I'd love to look after the sale for you. Shall we lock in a launch date?" }
  ],
  tips: [
    "The three sample calls are a starting point. Change the words until they sound like you.",
    "As a new associate, most of your leads will be cold. That's fine. Cold and warm leads are where most listings are won or lost, and giving value is a skill you can practise from day one.",
    "Every open home visitor, every door that opens and every geo data call starts as a cold lead. They turn warm once they reply, take your second call or tell you something about their plans. Start them on the cold 30-day trust plan the day you meet them.",
    "Keep the order: give first, ask last. The appraisal (your 30) is the ask for warm leads. The listing (your 3) is the ask for hot leads."
  ]
},
{
  id: "just-listed-door-knock",
  title: "Just Listed door knock",
  category: "Neighbourhood Campaigns",
  when: "After the Just Listed letter lands and before the home goes live, knock on the neighbours' doors around every new office listing.",
  goal: "Every neighbour knows about the listing, has an invitation to the neighbours' preview, and is in the CRM as geo data with a reason to hear from you again.",
  steps: [
    { label: "Greet", line: "Hi Josh, I'm (your name) from Ray White Mildura." },
    { label: "Reason", line: "I'm just popping round. You might have had a letter from us in your letterbox a few days back." },
    { label: "Courtesy notice", line: "The owners at (address) asked us to let the neighbours know their home is going on the market. So you might see a few more cars and people around the street over the next few weeks." },
    { label: "Invite", line: "Before it's advertised, we're holding a neighbours' preview this (day) at (time), and I'd love you to come and have a look." },
    { label: "Welcome", line: "It'd be great to see you there." },
    { label: "Then", line: "(Ask for their name and best number so you can confirm the preview time, then add them to the CRM. That's one piece of geo data per door.)" }
  ],
  tips: [
    "This is the warmest door knock there is. You have a reason, the letter got there first, and you're handing out an invitation, not asking for anything.",
    "It doesn't need to be your listing. Ask Damian or Luke which new office listings you can knock around this week.",
    "Aim for the 50 nearest homes. Every Neighbourhood Campaign sets out to turn one listing into one or two more, and the neighbours are where those come from.",
    "Record it on the Campaign Snapshot: tick Doors knocked under When it lists, then fill in appraisals booked, new pipeline leads and new contacts for the week."
  ]
},
{
  id: "just-listed-phone",
  title: "Just Listed phone call",
  category: "Neighbourhood Campaigns",
  when: "The same week as the Just Listed door knock, for every neighbour you have a number for and every door that didn't open.",
  goal: "Every neighbour with a phone number hears about the listing and the neighbours' preview, and their record is confirmed while you have them.",
  steps: [
    { label: "Greet", line: "Hi Josh, it's (your name) here from Ray White Mildura." },
    { label: "Reason", line: "Just a quick call. You might have had a letter from us in your letterbox a few days back." },
    { label: "Courtesy notice", line: "The owners at (address) asked us to let the neighbours know their home is going on the market. So you might see a few more cars and people around the street over the next few weeks." },
    { label: "Invite", line: "Before it's advertised, we're holding a neighbours' preview this (day) at (time), and I'd love you to come and have a look." },
    { label: "Welcome", line: "It'd be great to see you there." },
    { label: "Then", line: "(Confirm name, address, phone and email. Ask if they'd like to know the result when it sells, and diary that call.)" }
  ],
  tips: [
    "Phone and door together cover the whole street. Knock in the afternoon, then call the no-answers and the known numbers in the next morning's session.",
    "A yes to the preview is a face-to-face meeting with a neighbour on your turf. Treat it as the start of a Doorstep Appraisal conversation.",
    "This call and the Fifty Neighbours calls go hand in hand. If you've already made the Fifty Neighbours call for this listing, lead with the preview invitation instead of repeating the traffic notice.",
    "Diary the Just Sold call now. The same list gets a second call when it sells."
  ]
},
{
  id: "just-sold-door-knock",
  title: "Just Sold door knock",
  category: "Neighbourhood Campaigns",
  when: "Within a week of any office sale, knock on the neighbours' doors with the result and news of the buyers who missed out.",
  goal: "A seller lead or an appraisal booked from the street, and every neighbour's details confirmed in the CRM.",
  steps: [
    { label: "Greet", line: "Hi Josh, I'm (your name) from Ray White Mildura." },
    { label: "The result", line: "I'm just popping round to let you know (address) has sold, and it was a great result. It went for $(price)." },
    { label: "The real reason", line: "The real reason I'm here is that 2 people who looked at the home missed out. They've asked me to call in on the neighbours and see if anyone else around here is thinking of selling." },
    { label: "The buyers", line: "They've got the money ready, their finance is approved, and they're keen to make an offer on the right home." },
    { label: "The ask", line: "Do you know anyone nearby who might be thinking of selling?" },
    { label: "If no", line: "No worries. If you ever need a hand with anything property-related, just give us a ring." },
    { label: "If yes", line: "(Book a time to do an appraisal. Does Wednesday or Friday suit?)" }
  ],
  tips: [
    "Only say the price if the vendor and buyer are happy for it to be shared. If not, 'a great result' is enough. Check with the listing agent first.",
    "'2 people missed out' must be true. Get the under-bidder count from the listing agent before you knock. It changes with every sale.",
    "'Anyone nearby' includes them. Plenty of owners answer 'well, we might be'. Pause after you ask.",
    "Every door, yes or no, is a details check and a piece of geo data. A Just Sold knock is often your biggest geo data day of the week."
  ]
},
{
  id: "just-sold-phone",
  title: "Just Sold phone call",
  category: "Neighbourhood Campaigns",
  when: "The same week as the Just Sold door knock, for every neighbour with a number, plus the callback you promised on the Just Listed or Fifty Neighbours call.",
  goal: "The promised result delivered, a seller lead asked for, and an appraisal booked where there is one.",
  steps: [
    { label: "Greet", line: "Hi Josh, (your name) here from Ray White Mildura." },
    { label: "The result", line: "Just a quick call to let you know (address) has sold, and it was a great result. It went for $(price)." },
    { label: "The real reason", line: "The main reason I'm calling is that 2 people who looked at the home missed out. They've asked me to get in touch with the neighbours and see if anyone else around here is thinking of selling." },
    { label: "The buyers", line: "They've got the money ready, their finance is approved, and they're keen to make an offer on the right home." },
    { label: "The ask", line: "Do you know anyone nearby who might be thinking of selling?" },
    { label: "If no", line: "No worries. If you ever need a hand with anything property-related, just give us a ring." },
    { label: "If yes", line: "(Book a time to do an appraisal. Does Wednesday or Friday suit?)" }
  ],
  tips: [
    "If you promised to let them know the result, this is the call that keeps that promise. Kept promises are what make your next call welcome.",
    "The under-bidders are real people with a real brief. Know roughly what they want so you can answer 'what are they after?' honestly.",
    "A 'no' still earns a details check and a note. A 'maybe' gets a note in the CRM today and two times for an appraisal.",
    "Record it on the Campaign Snapshot: tick Calls made under When it sells, then fill in appraisals booked, new pipeline leads and new contacts. One listing should lead to one or two more."
  ]
},
{
  id: "buyers-post-sale-call",
  title: "Buyers post-sale call",
  category: "Buyers",
  when: "After a home sells, call everyone who inspected it and didn't buy.",
  goal: "A seller lead from the buyer's circle, a clear picture of where their search is at, and the appraisal question raised again if they have a home to sell.",
  steps: [
    { label: "Greet and reason", line: "Hi (name), it's (your name) from Ray White Mildura. I'm calling to let you know that (address), which you looked at with us a few weeks ago, has now sold." },
    { label: "The result", line: "It went for $(price), which was a great result." },
    { label: "The buyers", line: "We've still got (number) buyers from that home who are keen to buy close by." },
    { label: "The ask", line: "Do you know anyone who might be thinking of selling?" },
    { label: "Their search", line: "And how's your own search going? Have you found the right place yet?" },
    { label: "Revisit", line: "(Bring back the appraisal question from the first OFI callback: do they still need to sell before they buy?)" }
  ],
  tips: [
    "Buyers who missed out are warm, a bit disappointed and glad to get a call. Most agents never ring them.",
    "A buyer with a home to sell is a seller. If the OFI callback showed they're upsizing or downsizing, this is the call to book the appraisal: Does Wednesday or Friday suit?",
    "Update their brief while you have them. A qualified buyer is what keeps your Timing Question honest on tomorrow's pipeline calls.",
    "Only quote the price if it's public. If it isn't, call it a great result and go straight to the ask. Treat the buyer count the same way: use the real number from the listing agent, never a guess."
  ]
},
{
  id: "ofi-callback",
  title: "OFI callback questions",
  category: "Buyers",
  when: "Within 24 hours of every open home or neighbours' preview, ring each person who came through, on the owners' behalf.",
  goal: "Feedback for the vendor, every visitor sorted into appraisal, pipeline or database, a seller referral asked for, and a broker referral where it fits.",
  steps: [
    { label: "Introduction", line: "Hi (name), it's (your name) from Ray White Mildura. I'll be quick. I'm calling on behalf of the owners of (address) to get your thoughts on the home after your inspection." },
    { label: "Appraisal opportunity", line: "First up, are you looking to move to something smaller or something bigger than your current home?" },
    { label: "If yes", line: "Let's find a time next week and I'll come past and give you an idea of what your place could sell for right now. Which suits better, Wednesday or Friday? (If they plan to sell in the next 12 months, note it in the CRM today. Once you've appraised the home, it goes on your pipeline with its timeframe.)" },
    { label: "Database opportunity (if no)", line: "We send out a market update every quarter. If you give me your address, I'll make sure one reaches you next week. And if I can grab your email, I'll send it there too so it's easier next time." },
    { label: "Property feedback", line: "What did you think of (address)? How did you find the view? And the kitchen? (Ask about the good and the bad. You're after either an offer or feedback on price.)" },
    { label: "Other sellers in the area", line: "Last thing before I let you go. Do you know anyone else who's thinking of selling? Or anyone who's tried to sell and had no luck?" },
    { label: "Finance, option 1", line: "Can I ask, have you had a chat with a bank yet? (If no, go to the broker line. If yes:) Did you go to them directly, or use a broker?" },
    { label: "Finance, option 2", line: "Can I ask, are you buying your first home, are you already a home owner, or are you an investor?" },
    { label: "The broker line", line: "I only ask because we work closely with a large mortgage broker group that helps people save money on their home loan. They can compare more than 30 lenders, and the first chat is free with no obligation. The lenders pay them for the loans they arrange, and they pay us a referral fee, so I want you to know that up front. Their local team is professional and quick to respond, and I recommend them. Would you be happy for me to pass your details on to them?" }
  ],
  tips: [
    "Ask the appraisal question first, before feedback. Every open home visitor could be a seller, and this is where a good share of your 30 appraisals will come from.",
    "A 'no' still gets you an address and an email. That's a piece of geo data from every call.",
    "Before you use the finance questions, check with Damian or Luke which broker we work with, how many lenders they really compare and how the referral fee is disclosed. Use the real numbers, not the sample in this script.",
    "Feedback goes to the vendor the same day. You're calling on their behalf, so pass on what you heard, good and bad."
  ]
},
{
  id: "objection-handlers",
  title: "Objection handlers (office guidance)",
  category: "Prospecting",
  when: "Any time a prospecting call or door knock hits a wall: answer with courtesy, give value first, and leave the door open.",
  goal: "Either details in the CRM, a time in the diary, or a clean exit that means you can call again next quarter.",
  steps: [
    { label: "Not interested", line: "No worries, and thanks for being upfront. Most people I talk to aren't selling, and that's not why I'm ringing. I'm sending the (lead magnet) to a few homes in (street) so you can see what places are going for. Can I pop one in the mail for you?" },
    { label: "I already have an agent", line: "That's great, it's good to have someone in your corner, and I'm not asking you to change anything. I'll send you the market update so you've got a second set of numbers when the time comes. What's the best address for it?" },
    { label: "How did you get my number?", line: "Fair question. (Say exactly how: you met at the door, they came through an open home, or they're on the office database.) I'm ringing to introduce myself as the Ray White Mildura person for your street. If you'd rather I didn't call again, just say so and I'll note it now. Otherwise, would it be OK to send you the market update?" },
    { label: "What's it worth?", line: "Good question, and from here I'd only be guessing. Give me 15 minutes at the place and I'll give you a conservative range based on what has really sold around you. No obligation, and no pressure to sell. Does Wednesday or Friday suit?" },
    { label: "Just send me something", line: "Happy to. I'll have the (lead magnet) to you this week. Can I grab the best address and a mobile so I can check it arrived? I'll be in (street) next week dropping a few off, so I'll say a quick hello then too." },
    { label: "We're not selling", line: "That's fine, most people I talk to aren't, and I'm not ringing to sell your home. I like to get to know the owners in (area) well before they're ready to move. If I can grab your details, I'll keep you posted on what sells nearby. Is there anything in the next 12 months I can help with?" },
    { label: "I'm busy", line: "Of course, I'll be quick. I'm only ringing to send you the (lead magnet). Can I grab your address and then I'll let you go? Or would 2pm or 4pm tomorrow be a better time?" },
    { label: "Take me off your list", line: "No problem at all, I'll do that now, and sorry for the interruption. If you ever need anything in real estate, I'm (your name) at Ray White Mildura. Have a good day." }
  ],
  tips: [
    "These are starting points, not lines to read flat. Put them in your own words. Two rules sit under all of them: never burn a bridge with a prospect, and a no is never about you personally.",
    "Value first, every time. The lead magnet, the market update and a Doorstep Appraisal are what you offer. You're never asking them to sell.",
    "Offer two times, not an open question. Wednesday or Friday, 2pm or 4pm.",
    "'Take me off your list' means exactly that. Mark the record do-not-call in the CRM before your next dial and follow the office do-not-call process. One kept promise protects the whole farm."
  ]
}
);
