const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, HeadingLevel
} = require('docx');
const fs = require('fs');

// Brand color: #8FC919 (closest hex docx supports)
const BRAND_GREEN = "8FC919";
const DARK_GRAY = "333333";
const LIGHT_GRAY = "F5F5F5";
const MID_GRAY = "E0E0E0";
const WHITE = "FFFFFF";

// Page: US Letter, 1-inch margins
// Content width = 12240 - 1440 - 1440 = 9360 DXA

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const cellBorders = { top: border, bottom: border, left: border, right: border };

const cellMargins = { top: 100, bottom: 100, left: 160, right: 160 };

function sectionHeading(text) {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        bold: true,
        size: 28,
        font: "Arial",
        color: BRAND_GREEN,
      }),
    ],
    spacing: { before: 360, after: 120 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 4, color: BRAND_GREEN, space: 4 },
    },
  });
}

function subHeading(text) {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        bold: true,
        size: 24,
        font: "Arial",
        color: DARK_GRAY,
      }),
    ],
    spacing: { before: 240, after: 80 },
  });
}

function bodyPara(text, options = {}) {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        size: 22,
        font: "Arial",
        color: DARK_GRAY,
        ...options,
      }),
    ],
    spacing: { before: 60, after: 60 },
  });
}

function bulletItem(text) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    children: [
      new TextRun({
        text,
        size: 22,
        font: "Arial",
        color: DARK_GRAY,
      }),
    ],
    spacing: { before: 40, after: 40 },
  });
}

function numberedItem(text) {
  return new Paragraph({
    numbering: { reference: "numbered", level: 0 },
    children: [
      new TextRun({
        text,
        size: 22,
        font: "Arial",
        color: DARK_GRAY,
      }),
    ],
    spacing: { before: 40, after: 40 },
  });
}

function spacer(size = 120) {
  return new Paragraph({ children: [new TextRun("")], spacing: { before: 0, after: size } });
}

// Upgrade thresholds table
function upgradeTable() {
  const headerCell = (text) => new TableCell({
    borders: cellBorders,
    width: { size: 4680, type: WidthType.DXA },
    shading: { fill: "2D2D2D", type: ShadingType.CLEAR },
    margins: cellMargins,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, size: 22, font: "Arial", color: WHITE })],
    })],
  });

  const dataRow = (col1, col2, shade) => new TableRow({
    children: [
      new TableCell({
        borders: cellBorders,
        width: { size: 4680, type: WidthType.DXA },
        shading: { fill: shade, type: ShadingType.CLEAR },
        margins: cellMargins,
        children: [new Paragraph({
          children: [new TextRun({ text: col1, bold: true, size: 22, font: "Arial", color: DARK_GRAY })],
        })],
      }),
      new TableCell({
        borders: cellBorders,
        width: { size: 4680, type: WidthType.DXA },
        shading: { fill: shade, type: ShadingType.CLEAR },
        margins: cellMargins,
        children: [new Paragraph({
          children: [new TextRun({ text: col2, size: 22, font: "Arial", color: DARK_GRAY })],
        })],
      }),
    ],
  });

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [4680, 4680],
    rows: [
      new TableRow({
        children: [
          headerCell("User Count"),
          headerCell("Recommended Action"),
        ],
        tableHeader: true,
      }),
      dataRow("100+ active users", "Upgrade Resend to Starter ($20/mo — 50,000 emails/month)", WHITE),
      dataRow("500+ active users", "Upgrade Supabase to Pro ($25/mo — removes pause, more bandwidth)", LIGHT_GRAY),
      dataRow("1,000+ active users", "Both upgrades, monitor Realtime connections", WHITE),
      dataRow("5,000+ users", "Revisit architecture", LIGHT_GRAY),
    ],
  });
}

const doc = new Document({
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: "\u2022",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 560, hanging: 280 } } },
        }],
      },
      {
        reference: "numbered",
        levels: [{
          level: 0,
          format: LevelFormat.DECIMAL,
          text: "%1.",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 560, hanging: 280 } } },
        }],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: "Joinzer",
                bold: true,
                size: 18,
                font: "Arial",
                color: BRAND_GREEN,
              }),
              new TextRun({
                text: "  \u00B7  Las Vegas Pilot  \u00B7  Build Summary & Capacity Estimate",
                size: 18,
                font: "Arial",
                color: "888888",
              }),
            ],
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 4, color: MID_GRAY, space: 4 },
            },
            spacing: { after: 0 },
          }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: "Joinzer \u00B7 Las Vegas Pilot \u00B7 joinzer.com",
                size: 18,
                font: "Arial",
                color: "888888",
              }),
              new TextRun({
                text: "    Page ",
                size: 18,
                font: "Arial",
                color: "888888",
              }),
              new TextRun({
                children: [PageNumber.CURRENT],
                size: 18,
                font: "Arial",
                color: "888888",
              }),
            ],
            alignment: AlignmentType.RIGHT,
            border: {
              top: { style: BorderStyle.SINGLE, size: 4, color: MID_GRAY, space: 4 },
            },
            spacing: { before: 0 },
          }),
        ],
      }),
    },
    children: [
      // ── Title block ──────────────────────────────────────────────────
      spacer(240),
      new Paragraph({
        children: [
          new TextRun({
            text: "Joinzer",
            bold: true,
            size: 64,
            font: "Arial",
            color: BRAND_GREEN,
          }),
        ],
        spacing: { before: 0, after: 40 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: "Build Summary & Capacity Estimate",
            bold: true,
            size: 36,
            font: "Arial",
            color: DARK_GRAY,
          }),
        ],
        spacing: { before: 0, after: 80 },
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: "Las Vegas Pilot  \u00B7  April 2026",
            size: 24,
            font: "Arial",
            color: "888888",
          }),
        ],
        spacing: { before: 0, after: 480 },
      }),

      // ── SECTION 1: Features Built ────────────────────────────────────
      sectionHeading("Section 1: Features Built"),
      spacer(60),

      // Profile & Photos
      subHeading("Profile & Photos"),
      bulletItem("Profile photo upload on setup and edit"),
      bulletItem("Photos display on profile page and Players grid"),
      bulletItem("Supabase avatars storage bucket configured as public"),
      spacer(80),

      // Players Page
      subHeading("Players Page"),
      bulletItem("New Players tab in bottom nav (3rd tab with group icon)"),
      bulletItem("3-column grid showing first name, photo, DUPR/estimated rating, and Joinzer Level"),
      bulletItem("Skill filter pills: 7 ranges from 2.0 to 5.0+"),
      spacer(80),

      // Availability Signaling
      subHeading("Availability Signaling"),
      bulletItem("\u201CSet availability\u201D button on Sessions feed"),
      bulletItem("Modal to pick date and multiple time windows (Morning / Afternoon / Evening)"),
      bulletItem("Available players show green border and time badge (AM / PM / Eve / All) on Players grid"),
      bulletItem("Tap an available player card to invite them to a session"),
      spacer(80),

      // Invite to Session
      subHeading("Invite to Session"),
      bulletItem("Tapping an available player opens an invite modal"),
      bulletItem("Captain picks from their upcoming sessions and sends a branded email invite"),
      bulletItem("Invited player receives email with session details and a Join Session button"),
      bulletItem("If captain has no upcoming sessions, modal offers a Create Session link"),
      spacer(80),

      // Recurring Sessions
      subHeading("Recurring Sessions"),
      bulletItem("Repeat toggle on session create form: No repeat / Weekly / Every 2 weeks"),
      bulletItem("Creates 8 independent sessions spaced by the chosen interval"),
      bulletItem("Creator is automatically joined to all 8 occurrences"),
      bulletItem("Each session can be edited or cancelled independently"),
      spacer(80),

      // Skill Ladder
      subHeading("Skill Ladder"),
      bulletItem("Captain rates each player after session ends: Below me / My level / Above me"),
      bulletItem("Ratings adjust each player\u2019s internal Joinzer score (+12 above, +2 same, -8 below)"),
      bulletItem("Joinzer Level labels: Beginner (under 950) / Intermediate (950\u20131099) / Advanced (1100\u20131249) / Elite (1250+)"),
      bulletItem("Starting score seeded from DUPR or estimated rating on signup and profile edit"),
      bulletItem("Joinzer Level displayed on every player card and on the profile page"),
      spacer(80),

      // Security
      subHeading("Security"),
      bulletItem("All email API routes require an authenticated session (bots blocked)"),
      bulletItem("One-click unsubscribe link in every notification email"),
      bulletItem("Supabase avatars bucket set to public (fixed broken photo display)"),
      bulletItem("Password-based auth with Supabase built-in rate limiting"),
      spacer(80),

      // Email Notifications
      subHeading("Email Notifications"),
      bulletItem("Session confirmation email sent to creator on session creation"),
      bulletItem("New session opt-in notifications sent to all subscribed users"),
      bulletItem("Player invite email when captain invites an available player"),
      bulletItem("Unsubscribe flow with branded confirmation page at /unsubscribed"),
      bulletItem("All emails sent via Resend from support@joinzer.com, replies go to martyfit50@gmail.com"),
      spacer(200),

      // ── SECTION 2: Capacity Estimate ─────────────────────────────────
      sectionHeading("Section 2: Capacity Estimate"),
      spacer(60),
      bodyPara(
        "Based on the current stack (Vercel Hobby + Supabase Free + Resend Free), here is an honest breakdown of how many users Joinzer can handle and where the limits are."
      ),
      spacer(80),

      // Comfortable Range
      subHeading("Comfortable Range"),
      bodyPara(
        "500 to 2,000 active users with current free-tier plans. Could push to 5,000\u201310,000 with plan upgrades only \u2014 no code changes required."
      ),
      spacer(80),

      // What Breaks First
      subHeading("What Breaks First (In Order)"),
      numberedItem("Resend free tier \u2014 100 emails/day limit fills up quickly with active session creation"),
      numberedItem("Supabase Realtime \u2014 200 concurrent connection limit on free tier"),
      numberedItem("Supabase Storage \u2014 avatar photos fill the 2GB limit around 2,000\u20134,000 users"),
      numberedItem("Supabase bandwidth \u2014 5GB/month at heavy usage"),
      spacer(80),

      // Upgrade Thresholds
      subHeading("Upgrade Thresholds"),
      upgradeTable(),
      spacer(80),

      // Current Stack
      subHeading("Current Stack"),
      bulletItem("Frontend: Next.js 14 (App Router) on Vercel"),
      bulletItem("Backend: Supabase (Postgres + Auth + Realtime + Storage)"),
      bulletItem("Email: Resend via support@joinzer.com"),
      bulletItem("Hosting: Vercel (auto-deploy from GitHub)"),
      bulletItem("Total monthly cost at 1,000 users: ~$45/month"),
      spacer(120),
    ],
  }],
});

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync("C:/Users/marty/projects/Joinzer/docs/joinzer_summary.docx", buffer);
  console.log("joinzer_summary.docx written successfully");
});
