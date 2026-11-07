import { describe, expect, it } from "vitest";
import { checkSocialUrl, hiddenSocialLinkMessage, hiddenSocialLinks, reviewSocialLinksInput, socialButtons, socialUrlMessage, type SocialNetwork, type SocialUrlIssue } from "./social-links";

const none = { facebook: null, instagram: null, linkedin: null, tiktok: null, youtube: null, x: null };

describe("liens vers les réseaux sociaux (pied de page)", () => {
  const ORDER = ["facebook", "instagram", "linkedin", "tiktok", "youtube", "x"];
  const hrefs = (links: Parameters<typeof socialButtons>[0]) => socialButtons(links).map((button) => button.href);

  it("renvoie toujours les six réseaux, sans lien (href null), tant qu'aucune adresse n'est saisie", () => {
    const buttons = socialButtons(none);
    expect(buttons.map((button) => button.network)).toEqual(ORDER);
    expect(buttons.every((button) => button.href === null)).toBe(true);
  });

  it("garde les six réseaux dans un ordre fixe, avec libellé et icône ; href seulement pour les adresses valides", () => {
    const buttons = socialButtons({ ...none, x: "https://x.com/futani", facebook: "https://facebook.com/futani" });
    expect(buttons).toEqual([
      { network: "facebook", label: "Facebook", icon: "facebook", href: "https://facebook.com/futani" },
      { network: "instagram", label: "Instagram", icon: "instagram", href: null },
      { network: "linkedin", label: "LinkedIn", icon: "linkedin", href: null },
      { network: "tiktok", label: "TikTok", icon: "tiktok", href: null },
      { network: "youtube", label: "YouTube", icon: "youtube", href: null },
      { network: "x", label: "X (Twitter)", icon: "x", href: "https://x.com/futani" },
    ]);
  });

  it("couvre les six réseaux administrables avec leur adresse", () => {
    const all = {
      facebook: "https://www.facebook.com/futani",
      instagram: "https://www.instagram.com/futani",
      linkedin: "https://www.linkedin.com/company/futani",
      tiktok: "https://www.tiktok.com/@futani",
      youtube: "https://www.youtube.com/@futani",
      x: "https://x.com/futani",
    };
    expect(socialButtons(all).map((button) => button.network)).toEqual(ORDER);
    expect(hrefs(all)).toEqual(Object.values(all));
  });

  it("une valeur nulle, vide, dangereuse, imitant un domaine ou raccourcie donne href null, jamais l'adresse", () => {
    const buttons = socialButtons({
      facebook: null,
      instagram: "",
      linkedin: "javascript:alert(1)",
      tiktok: "https://tiktok.com.evil.example/@futani",
      youtube: "https://youtu.be.evil.example/futani",
      x: "https://t.co/abc",
    });
    expect(buttons.map((button) => button.network)).toEqual(ORDER);
    expect(buttons.map((button) => button.href)).toEqual([null, null, null, null, null, null]);
    expect(hrefs({ ...none, facebook: "https://fb.me/futani", instagram: "https://evilinstagram.com/futani" })).toEqual([null, null, null, null, null, null]);
  });

  it("n'expose jamais une ancienne valeur non conforme restée en base (http, identifiants, autre domaine)", () => {
    const buttons = socialButtons({ ...none, youtube: "http://youtube.com/futani", x: "https://user:pw@x.com/futani", facebook: "https://example.com/futani", tiktok: "https://tiktok.com/@futani" });
    expect(buttons.map((button) => button.href)).toEqual([null, null, null, "https://tiktok.com/@futani", null, null]);
  });

  it("signale les liens enregistrés mais non affichés, avec un message explicite", () => {
    expect(hiddenSocialLinks(none)).toEqual([]);
    expect(hiddenSocialLinks({ ...none, facebook: "https://fb.me/futani", youtube: "https://www.youtube.com/@futani" })).toEqual([
      { network: "facebook", message: socialUrlMessage("facebook", "shortlink") },
    ]);
  });
});

describe("checkSocialUrl : domaines officiels acceptés", () => {
  const accepted: [SocialNetwork, string][] = [
    ["facebook", "https://facebook.com/futani"],
    ["facebook", "https://www.facebook.com/futani"],
    ["facebook", "https://m.facebook.com/futani"],
    ["facebook", "https://web.facebook.com/futani"],
    ["facebook", "https://business.facebook.com/futani"],
    ["facebook", "https://fb.com/futani"],
    ["facebook", "https://www.facebook.com/profile.php?id=100012345678"],
    ["facebook", "https://www.facebook.com/share/1AbCdEf/"],
    ["facebook", "https://WWW.FACEBOOK.COM/futani"],
    ["facebook", "https://facebook.com./futani"],
    ["facebook", "https://facebook.com:443/futani"],
    // Pleine chasse : ramené par l'analyseur d'URL (comme le navigateur) au vrai facebook.com.
    ["facebook", "https://ｆacebook.com/futani"],
    ["instagram", "https://www.instagram.com/futani"],
    ["instagram", "https://www.instagram.com/futani?igsh=abc123"],
    ["instagram", "https://instagr.am/futani"],
    ["linkedin", "https://www.linkedin.com/company/futani"],
    ["linkedin", "https://sn.linkedin.com/company/futani"],
    ["linkedin", "https://fr.linkedin.com/in/jean-dupont"],
    ["tiktok", "https://www.tiktok.com/@futani"],
    ["tiktok", "https://www.tiktok.com/@futani?_t=8abc"],
    ["tiktok", "https://m.tiktok.com/@futani"],
    ["youtube", "https://www.youtube.com/@futani"],
    ["youtube", "https://youtube.com/@futani?si=abc"],
    ["youtube", "https://m.youtube.com/channel/UCabc"],
    ["youtube", "https://music.youtube.com/channel/UCabc"],
    ["youtube", "https://youtu.be/dQw4w9WgXcQ"],
    ["x", "https://x.com/futani"],
    ["x", "https://x.com/futani?s=21"],
    ["x", "https://twitter.com/futani"],
    ["x", "https://mobile.twitter.com/futani"],
    // Pages dont le nom commence comme un chemin refusé : comparaison par segment entier.
    ["facebook", "https://www.facebook.com/loginfutani"],
    ["youtube", "https://www.youtube.com/@redirect-futani"],
    ["x", "https://x.com/i"],
  ];

  it.each(accepted)("%s : %s", (network, url) => {
    expect(checkSocialUrl(network, url)).toBeNull();
  });
});

describe("checkSocialUrl : adresses refusées", () => {
  const rejected: [SocialNetwork, string, SocialUrlIssue][] = [
    ["facebook", "http://facebook.com/futani", "not-https"],
    ["facebook", "HTTPS://facebook.com/futani", "not-https"],
    ["facebook", "javascript:alert(1)", "not-https"],
    ["facebook", "data:text/html,<script>alert(1)</script>", "not-https"],
    ["facebook", "//facebook.com/futani", "not-https"],
    ["facebook", "https:facebook.com/futani", "not-https"],
    ["facebook", "https://", "invalid"],
    ["facebook", "https://user:pw@facebook.com/futani", "credentials"],
    ["facebook", "https://facebook.com@evil.sn/futani", "credentials"],
    ["facebook", "https://facebook.com:8443/futani", "port"],
    ["facebook", "https://fb.me/futani", "shortlink"],
    ["facebook", "https://l.facebook.com/l.php?u=https://evil.sn", "shortlink"],
    ["facebook", "https://fb.watch/abc", "shortlink"],
    ["facebook", "https://www.facebook.com/l.php?u=https://evil.sn", "redirect"],
    ["facebook", "https://evilfacebook.com/futani", "host"],
    ["facebook", "https://facebook.com.evil.sn/futani", "host"],
    ["facebook", "https://sn.facebook.com/futani", "host"],
    ["facebook", "https://evil.sn/facebook.com/futani", "host"],
    ["facebook", "https://faceb00k.com/futani", "host"],
    ["facebook", "https://fаcebook.com/futani", "host"],
    ["facebook", "https://facebook.com", "no-path"],
    ["facebook", "https://facebook.com/", "no-path"],
    ["facebook", "https://facebook.com/?ref=x", "no-path"],
    ["instagram", "https://facebook.com/futani", "host"],
    ["instagram", "https://ig.me/m/futani", "shortlink"],
    ["linkedin", "https://lnkd.in/abc", "shortlink"],
    ["linkedin", "https://evillinkedin.com/in/x", "host"],
    ["linkedin", "https://linkedin.com.evil.sn/in/x", "host"],
    ["linkedin", "https://api.dev.linkedin.com/in/x", "host"],
    ["linkedin", "https://www.linkedin.com/redir/redirect?url=https://evil.sn", "redirect"],
    ["tiktok", "https://vm.tiktok.com/ZMabc", "shortlink"],
    ["tiktok", "https://vt.tiktok.com/ZSabc", "shortlink"],
    ["tiktok", "https://tiktok.com.evil.sn/@x", "host"],
    ["youtube", "https://youtube-nocookie.com/embed/abc", "host"],
    ["youtube", "https://www.youtube.com/redirect?q=https://evil.sn", "redirect"],
    ["youtube", "https://youtu.be/", "no-path"],
    ["x", "https://t.co/abc", "shortlink"],
    ["x", "https://x.com.evil.sn/futani", "host"],
    // Redirections : casse, encodage et doubles barres obliques normalisés avant comparaison.
    ["facebook", "https://facebook.com/L.PHP?u=https://evil.sn", "redirect"],
    ["facebook", "https://facebook.com/%6C.php?u=https://evil.sn", "redirect"],
    ["facebook", "https://facebook.com//l.php?u=https://evil.sn", "redirect"],
    ["facebook", "https://www.facebook.com/flx/warn/?u=https://evil.sn", "redirect"],
    ["facebook", "https://www.facebook.com/sharer/sharer.php?u=https://evil.sn", "redirect"],
    ["facebook", "https://www.facebook.com/dialog/feed?redirect_uri=https://evil.sn", "redirect"],
    ["facebook", "https://www.facebook.com/futani?next=https://evil.sn", "redirect"],
    ["facebook", "https://www.facebook.com/futani?u=//evil.sn", "redirect"],
    ["facebook", "https://facebook.com/%E0%A4%A", "invalid"],
    // Espaces ou caractères de contrôle (retirés par l'analyseur d'URL, mais publiés tels quels) : refusés.
    ["facebook", "https://www.facebook.com/futani ", "invalid"],
    ["x", "https://x.com/futani\n", "invalid"],
    ["x", "https://x.com/fu\ttani", "invalid"],
    ["youtube", "https://www.youtube.com/@futani\u0000", "invalid"],
    ["instagram", "https://www.instagram.com/accounts/login/?next=/futani", "redirect"],
    ["linkedin", "https://www.linkedin.com/REDIR/redirect?url=https://evil.sn", "redirect"],
    ["linkedin", "https://www.linkedin.com/safety/go/?url=https://evil.sn", "redirect"],
    ["youtube", "https://www.youtube.com/Redirect?q=https://evil.sn", "redirect"],
    ["youtube", "https://www.youtube.com/attribution_link?u=/watch", "redirect"],
    ["x", "https://x.com/i/redirect?url=https://evil.sn", "redirect"],
    ["facebook", "https://fb.me./futani", "shortlink"],
    ["x", "https://t.co./abc", "shortlink"],
  ];

  it.each(rejected)("%s : %s → %s", (network, url, issue) => {
    expect(checkSocialUrl(network, url)).toBe(issue);
  });
});

describe("socialUrlMessage", () => {
  it("nomme le réseau et guide la correction", () => {
    expect(socialUrlMessage("tiktok", "shortlink")).toMatch(/^Lien TikTok : .*copiez l'adresse complète/);
    expect(socialUrlMessage("x", "host")).toBe("Lien X (Twitter) : cette adresse n'appartient pas au domaine officiel de X (Twitter).");
  });
});

describe("liens enregistrés non conformes : sans lien, un par un", () => {
  it("une valeur nulle, vide, mal formée ou suspecte n'est jamais publiée ; les autres réseaux gardent leur lien", () => {
    const links = {
      facebook: "javascript:alert(1)",
      instagram: "https://www.instagram.com/futani",
      linkedin: "",
      tiktok: "tiktok.com/@futani",
      youtube: null,
      x: "https://x.com/futani",
    };
    expect(socialButtons(links).map((button) => button.href)).toEqual([null, "https://www.instagram.com/futani", null, null, null, "https://x.com/futani"]);
    expect(hiddenSocialLinks(links).map((link) => link.network)).toEqual(["facebook", "tiktok"]);
  });

  it("donne la raison du masquage pour un réseau (rien si vide ou conforme)", () => {
    expect(hiddenSocialLinkMessage("youtube", "http://youtube.com/futani")).toBe(socialUrlMessage("youtube", "not-https"));
    expect(hiddenSocialLinkMessage("youtube", "https://www.youtube.com/@futani")).toBeNull();
    expect(hiddenSocialLinkMessage("youtube", null)).toBeNull();
    expect(hiddenSocialLinkMessage("youtube", "")).toBeNull();
  });
});

describe("reviewSocialLinksInput : saisie comparée aux liens enregistrés", () => {
  const official = {
    facebook: "https://www.facebook.com/futani",
    instagram: "https://www.instagram.com/futani",
    linkedin: "https://www.linkedin.com/company/futani",
    tiktok: "https://www.tiktok.com/@futani",
    youtube: "https://www.youtube.com/@futani",
    x: "https://x.com/futani",
  } as const;
  const networks = Object.keys(official) as SocialNetwork[];

  it("un lien nouveau ou modifié doit être conforme, pour les six réseaux", () => {
    for (const network of networks) {
      const submit = (href: string) => reviewSocialLinksInput({ ...none, [network]: href }, none);
      expect(submit(official[network])).toEqual({ links: { ...none, [network]: official[network] }, fieldErrors: {} });
      for (const href of ["https://example.com/futani", official[network].replace("https://", "http://"), "javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "https:example.com", "//example.com/futani", "https://user:pw@example.com", "ftp://example.com"]) {
        expect(Object.keys(submit(href).fieldErrors)).toEqual([`socialLinks.${network}`]);
      }
    }
  });

  it("rattache le message explicite du validateur central au champ du réseau", () => {
    expect(reviewSocialLinksInput({ ...none, tiktok: "https://vm.tiktok.com/ZMabc" }, none).fieldErrors).toEqual({
      "socialLinks.tiktok": [socialUrlMessage("tiktok", "shortlink")],
    });
  });

  it("un ancien lien non conforme laissé inchangé est conservé tel quel, sans erreur (jamais supprimé ni remplacé)", () => {
    const stored = { ...none, youtube: "http://youtube.com/futani", facebook: " https://fb.me/futani " };
    const review = reviewSocialLinksInput({ ...none, youtube: "http://youtube.com/futani", facebook: "https://fb.me/futani" }, stored);
    expect(review).toEqual({ links: stored, fieldErrors: {} });
  });

  it("une saisie identique à la valeur brute enregistrée (espaces compris) est aussi conservée", () => {
    const stored = { ...none, x: "  https://t.co/abc " };
    expect(reviewSocialLinksInput(stored, stored)).toEqual({ links: stored, fieldErrors: {} });
    expect(Object.keys(reviewSocialLinksInput({ ...none, x: " https://t.co/abc" }, stored).fieldErrors)).toEqual(["socialLinks.x"]);
  });

  it("chaque lien se corrige individuellement : seul le champ modifié et non conforme est en erreur", () => {
    const stored = { ...none, youtube: "http://youtube.com/futani", x: "https://t.co/abc" };
    const review = reviewSocialLinksInput({ ...none, youtube: "https://www.youtube.com/@futani", x: "https://t.co/autre" }, stored);
    expect(review.fieldErrors).toEqual({ "socialLinks.x": [socialUrlMessage("x", "shortlink")] });
    expect(review.links.youtube).toBe("https://www.youtube.com/@futani");
  });

  it("vider un champ efface le lien, conforme ou non", () => {
    expect(reviewSocialLinksInput(none, { ...none, youtube: "http://youtube.com/futani", x: "https://x.com/futani" })).toEqual({ links: none, fieldErrors: {} });
  });
});
