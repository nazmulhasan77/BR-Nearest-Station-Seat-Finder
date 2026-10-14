# 🚆 BR Nearest-Station Seat Finder

<p align="center">
  <img src="Screenshorts/BR%20Nearest%20Station%20Seat%20Finder%20Banner.png" alt="BR Nearest Station Seat Finder Banner" width="100%">
</p>

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-success.svg)](https://chrome.google.com/webstore)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Privacy Friendly](https://img.shields.io/badge/Privacy-100%25%20Local-green.svg)](PRIVACY_POLICY.md)


An intelligent Chrome Extension for **Bangladesh Railway e-ticketing** ([eticket.railway.gov.bd](https://eticket.railway.gov.bd)).

When direct train seats for your route are completely sold out, this extension automatically discovers available seats from **stations just before or after your origin and destination** — without refreshing the page and in just one click!

> **Example:** You want to travel from `Chatmohar → Dhaka` on **Silk City Express**, but all S_CHAIR seats are sold out.
> The extension checks:
> - `Chatmohar → Tejgaon` (Get off 1 station early)
> - `Gofurabad → Dhaka` (Board 1 station earlier)
> - `Ishwardi → Dhaka` (Board from a major preceding junction)
> - `Boral Bridge → Dhaka`
> ... and shows you available seats along with detour distance and fares!

---

## ✨ Features / সুবিধাসমূহ

| Feature | Description / বাংলায় |
|---|---|
| **Route-based Neighbours** | যে ট্রেনগুলো আপনার রুটে চলে, তাদের অফিসিয়াল stoppage list থেকে origin/destination-এর আগের-পরের স্টেশন বের করে (1–3 hops)। |
| **Distance-based Neighbours** | জিপিএস সড়ক দূরত্ব (Road Detour) হিসাব করে আশেপাশের সুবিধাজনক স্টেশনগুলোও অন্তর্ভুক্ত করে। |
| **Both Ends Combined** | `Board earlier/later` এবং `Get off earlier/later` — সব ধরনের কম্বিনেশন একসাথে চেক করে। |
| **High Concurrency & Fast** | পেজ রিলোড ছাড়াই সরাসরি রেলওয়ের পাবলিক JSON API-তে parallel query করে সেকেন্ডের মধ্যে ফলাফল আনে। |
| **Smart Badges** | `same train` (একই ট্রেন, শুধু আগে/পরে উঠবেন), `board earlier +12 km`, `detour 18 km`, সিট সংখ্যা এবং ভাড়া প্রদর্শন করে। |
| **One-Click Redirect** | যেকোনো রেজাল্টে ক্লিক করলেই সরাসরি সেই রুটের অফিসিয়াল বুকিং পেজ খুলে যায়। |
| **Auto Refresh & Alert** | ৩০/৬০ সেকেন্ড পরপর ব্যাকগ্রাউন্ড রিফ্রেশ এবং সিট খালি হওয়া মাত্রই ডেক্সটপ নোটিফিকেশন অ্যালার্ট। |
| **Offline Data Bundled** | ৪২৫টি স্টেশন ও ২২৪টি ট্রেনের সময়সূচী এক্সটেনশনের ভেতরেই সংরক্ষিত — কোনো বাহ্যিক সার্ভার নির্ভরতা নেই। |

---

## 📸 Screenshots / ইন্টারফেস প্রিভিউ

<p align="center">
  <img src="Screenshorts/Screenshorts%20(1).png" width="32%" alt="Search Interface">
  <img src="Screenshorts/Screenshorts%20(2).png" width="32%" alt="Seat Finder Panel">
  <img src="Screenshorts/Screenshorts%20(3).png" width="32%" alt="Alternative Options">
</p>

---

## 📦 Installation / ইনস্টলেশন নির্দেশিকা

### Chrome / Edge / Brave / Opera

1. এই রিপোজিটরিটি ডাউনলোড বা ক্লোন করুন:
   ```bash
   git clone https://github.com/nazmulhasan77/BR-Nearest-Station-Seat-Finder.git
   ```
   *(অথবা রিলিজ সেকশন থেকে `br-seat-finder.zip` ডাউনলোড করে আনজিপ করুন)*
2. ব্রাউজারে যান: `chrome://extensions` *(Edge-এ `edge://extensions`)*
3. উপরের ডানদিকের **Developer mode** টগলটি চালু (ON) করুন।
4. বাম পাশের **Load unpacked** বাটনে ক্লিক করুন।
5. এই প্রজেক্ট ফোল্ডারটি (`br-seat-finder`) সিলেক্ট করুন।
6. এবার [eticket.railway.gov.bd](https://eticket.railway.gov.bd)-এ গিয়ে লগইন করে যেকোনো ট্রেনের টিকিট সার্চ করুন। পেজের নিচে-ডানে সহকারী প্যানেল দেখতে পাবেন!

---

## 🔧 Architecture / কীভাবে কাজ করে

```
content.js  ──(chrome.runtime port)──►  background.js  ──fetch──►  railspaapi.shohoz.com
   │                                                                 (/bookings/search-trips-v2)
   │  localStorage থেকে token/uudid/ssdk পড়ে                                │
   │                                                                        │
   └────────────── panel render ◄──── rows ◄──── lib/finder.js ◄──── JSON ──┘
```

1. **Detect:** বর্তমান সার্চ রেজাল্ট পেজের URL (`?fromcity=Chatmohar&tocity=Dhaka&doj=...&class=...`) থেকে যাত্রা বিশ্লেষণ করে।
2. **Plan (`lib/planner.js`):** অফলাইন ডেটাসেট ব্যবহার করে প্রাসঙ্গিক কাছাকাছি স্টেশন পেয়ার তৈরি করে (Hops এবং Road detour ফিল্টার প্রয়োগ করে)।
3. **Query (`background.js`):** ফিল্টারকৃত স্টেশন পেয়ারগুলোর সিট স্ট্যাটাস জানতে নিরাপদ রেট-লিমিট বজায় রেখে ব্যাকগ্রাউন্ডে কুয়েরি চালায়।
4. **Render (`content.js` + `lib/finder.js`):** প্রাপ্ত ডেটা থেকে যেগুলোতে `online > 0` সিট আছে, সেগুলোকে স্মার্ট ব্যাজ সহ সাজিয়ে ইউজার ইন্টারফেসে প্রদর্শন করে।

---

## ⚙️ Settings (কনফিগারেশন)

এক্সটেনশনের অপশনস পেজে (`options.html`) নিচের সেটিংসগুলো পরিবর্তন করা যায়:

| Setting | Default | বিবরণ |
|---|---|---|
| **Route hops** | `2` | রুটে কত স্টেশন আগে বা পরের স্টেশন পর্যন্ত খুঁজবে। |
| **Max detour per end** | `60 km` | এর চেয়ে বেশি দূরত্বের বিকল্প স্টেশনগুলো বাদ দেবে। |
| **Distance-based neighbours** | `3` | সরাসরি দূরত্বের ভিত্তিতে কয়টি পার্শ্ববর্তী স্টেশন যোগ করবে। |
| **Max pairs to query** | `14` | একবারে সর্বোচ্চ কতগুলো স্টেশন পেয়ারে সার্চ চালাবে। |
| **Seat class override** | *(auto)* | নির্দিষ্ট কোনো ক্লাস (যেমন: `S_CHAIR`, `SNIGDHA`, `AC_B`) ফিল্টার করতে চাইলে। |
| **Auto refresh** | `Off` | প্রতি N সেকেন্ড পর পর স্বয়ংক্রিয়ভাবে সিট চেক করবে। |
| **Desktop Notifications** | `On` | নতুন সিট পাওয়া মাত্র ডেস্কটপ অ্যালার্ট পাঠাবে। |

---

## 🧪 Development & Testing

ব্রাউজারে লোড না করেও কমান্ড লাইনে টেস্টগুলো রান করা যায়:

```bash
# ইউনিট টেস্ট (parsing, name matching, geo, dates)
node tools/test_units.js

# পূর্ণাঙ্গ ফ্লো টেস্ট (mocked API সহ)
node tools/test_flow.js

# ৬টি বাস্তব রুটের উপর প্ল্যানার টেস্ট
node tools/test_planner.js

# নতুন সময়সূচী ডেটাসেট থেকে ডেটা ফাইল তৈরি করতে
python tools/build_data.py
```

---

## 📁 Project Structure

```
├── manifest.json          # Manifest V3 Configuration
├── background.js          # Service Worker (API queries, rate limiting, notifications)
├── content.js             # Content Script (UI Panel injection, DOM render)
├── content.css            # Scoped Styles for UI Panel
├── popup.html / js        # Browser action popup
├── options.html / js      # Settings and API diagnostic page
├── icons/                 # Extension icons (16, 32, 48, 128 px)
├── lib/
│   ├── api.js             # Shohoz / BR API client
│   ├── finder.js          # Core engine (plan -> query -> rows)
│   ├── geo.js             # Haversine distance & detour math
│   ├── planner.js         # Alternative station pairing planner
│   └── stations.js        # Station lookup, fuzzy matching
├── data/
│   ├── stations.js        # 425 railway stations dataset
│   ├── trains.js          # 224 trains with stoppage route lists
│   └── site-names.js      # Station code to official portal name map
├── tools/                 # Test suits and data build scripts
├── PRIVACY_POLICY.md      # Privacy policy documentation
└── privacy-policy.html    # Standalone HTML privacy policy
```

---

## 🔒 Privacy & Security

- **100% Local Processing:** আপনার ব্রাউজারের বাইরে কোনো ডেভেলপার সার্ভারে তথ্য পাঠানো হয় না।
- **Read-only Queries:** এটি শুধুমাত্র সিট খালি আছে কিনা তা খোঁজে। টিকিট বুকিং, পেমেন্ট বা ব্যক্তিগত তথ্যে হস্তক্ষেপ করে না।
- বিস্তারিত জানতে পড়ুন: [PRIVACY_POLICY.md](PRIVACY_POLICY.md) | [Web Version](https://butterflydevs.web.app/projects/br-seat-finder/privacy-policy)

---

## ⚖️ Disclaimer

This tool is an independent, open-source project developed for personal productivity and public convenience. It is **not** affiliated with, endorsed by, or operated in partnership with Bangladesh Railway, Shohoz-Synesis-Vincen JV, or any governmental authority.

---

## 👨‍💻 Author & Maintainer

**Md Nazmul Hasan**  
Team: **Butterfly Devs**  
Website: [butterflydevs.web.app](https://butterflydevs.web.app)  
GitHub: [@nazmulhasan77](https://github.com/nazmulhasan77)

---

⭐ **যদি এক্সটেনশনটি আপনার উপকারে আসে, তবে রিপোজিটরিতে একটি Star দিতে ভুলবেন না!**
