/* ==========================================================
   LIVRE D'OR PARTAGÉ (Supabase)
   Tous les visiteurs voient les mêmes messages, en direct.
   Chaque visiteur a un identifiant anonyme : seul l'auteur
   peut corriger ou retirer son message (règles côté Supabase).
   ========================================================== */
(() => {
  "use strict";

  /* ---------- RÉGLAGES SUPABASE ---------- */
  const SUPABASE_URL = "https://ldndkhnnpgcpdwcpssyq.supabase.co";
  const SUPABASE_CLE_PUBLIQUE = "sb_publishable_AWKiiYhu3j2LimFUlI-Y8w_B0u7JKR-"; // clé publique : sans danger dans un site
  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_CLE_PUBLIQUE);

  const $ = (id) => document.getElementById(id);
  const formulaire = $("formulaire"), champNom = $("nom"), champMessage = $("message");
  const erreurNom = $("erreur-nom"), erreurMessage = $("erreur-message"), compteur = $("compteur");
  const confirmation = $("confirmation"), mode = $("mode"), boutonAnnuler = $("annuler");
  const boutonEnvoi = formulaire.querySelector('button[type="submit"]');
  const texteEnvoi = $("texte-envoi"), liste = $("lettres"), vide = $("vide");
  const dialogue = $("dialogue-suppression");
  const TEXTE_VIDE = vide.textContent;

  const defilement = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

  /* ---------- ÉTAT ---------- */
  let MON_ID = null;         // identifiant anonyme de ce visiteur
  let messagesAffiches = []; // dernière liste reçue
  let enCorrection = null;   // id du message en cours de correction
  let nouvelleId = null;     // id du message à mettre en valeur
  let aSupprimer = null;     // id du message en attente de confirmation

  /* ---------- BASE DE DONNÉES (Supabase) ---------- */
  // Les colonnes de la table sont converties vers les noms utilisés par l'affichage
  const versMessage = (ligne) => ({
    id: ligne.id, auteurId: ligne.auteur_id, nom: ligne.nom,
    texte: ligne.texte, date: ligne.cree_le, corrige: ligne.corrige
  });

  async function chargerMessages() {
    const charger = () =>
      db.from("messages").select("*").order("cree_le", { ascending: false });

    let { data, error } = await charger();

    // Si le jeton a expiré, tenter de renouveler la session.
    if (
      error &&
      (error.code === "PGRST303" || /JWT expired/i.test(error.message || ""))
    ) {
      const { data: sessionData, error: refreshError } =
        await db.auth.refreshSession();

      if (!refreshError && sessionData.session) {
        MON_ID = sessionData.session.user.id;
        ({ data, error } = await charger());
      }
    }

    if (error) {
      throw error;
    }

    return data.map(versMessage);
  }

  async function ajouterMessage({ nom, texte }) {
    // auteur_id est rempli automatiquement par Supabase (identifiant du visiteur connecté)
    const { data, error } = await db.from("messages").insert({ nom, texte }).select("id").single();
    if (error) throw error;
    return data.id;
  }

  async function modifierMessage(id, { nom, texte }) {
    const { data, error } = await db.from("messages").update({ nom, texte, corrige: true }).eq("id", id).select("id");
    if (error) throw error;
    if (!data.length) throw new Error("Modification refusée");
  }

  async function supprimerMessage(id) {
    const { data, error } = await db.from("messages").delete().eq("id", id).select("id");
    if (error) throw error;
    if (!data.length) throw new Error("Suppression refusée");
  }

  /* ---------- AFFICHAGE ---------- */
  function creerBouton(libelle, auteur, action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lien";
    b.textContent = libelle;
    b.setAttribute("aria-label", `${libelle} le message de ${auteur}`);
    b.addEventListener("click", action);
    return b;
  }

  function creerCarte(m) {
    const carte = document.createElement("li");
    carte.className = "lettre";
    if (m.id === nouvelleId) carte.classList.add("lettre--nouvelle");
    if (m.id === enCorrection) carte.classList.add("lettre--edition");

    // textContent (et non innerHTML) : le texte saisi ne peut pas injecter de code
    const texte = document.createElement("p");
    texte.className = "lettre__texte";
    texte.textContent = m.texte;

    const nom = document.createElement("p");
    nom.className = "lettre__nom";
    nom.textContent = m.nom;

    const date = document.createElement("time");
    date.className = "lettre__date";
    date.dateTime = m.date;
    date.textContent = "Écrit le " +
      new Date(m.date).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" }) +
      (m.corrige ? " (corrigé)" : "");

    carte.append(texte, nom, date);

    if (MON_ID && m.auteurId === MON_ID) {   // boutons visibles seulement pour l'auteur
      const actions = document.createElement("div");
      actions.className = "lettre__actions";
      actions.append(
        creerBouton("Corriger", m.nom, () => commencerCorrection(m)),
        creerBouton("Retirer", m.nom, () => demanderSuppression(m))
      );
      carte.append(actions);
    }
    return carte;
  }

  function afficherMessages(messages = messagesAffiches) {
    messagesAffiches = messages;
    liste.replaceChildren(...messages.map(creerCarte));
    vide.textContent = TEXTE_VIDE;
    vide.hidden = messages.length > 0;

    const nouvelle = liste.querySelector(".lettre--nouvelle");
    if (nouvelle) nouvelle.scrollIntoView({ behavior: defilement, block: "center" });
    nouvelleId = null;
  }

  async function rafraichir() {
    try {
      afficherMessages(await chargerMessages());
    } catch (erreur) {
      console.error(erreur);
      if (!messagesAffiches.length) {
        vide.hidden = false;
        vide.textContent = "Impossible de charger les messages pour le moment. Réessaie dans un instant.";
      }
    }
  }

  /* ---------- FORMULAIRE : validation et retour visuel ---------- */
  function majCompteur() {
    compteur.textContent = `${champMessage.value.length} / ${champMessage.maxLength}`;
  }

  function effacerErreurs() {
    erreurNom.textContent = "";
    erreurMessage.textContent = "";
    champNom.removeAttribute("aria-invalid");
    champMessage.removeAttribute("aria-invalid");
  }

  function valider(nom, texte) {
    effacerErreurs();
    let premierChampInvalide = null;
    if (!nom) {
      erreurNom.textContent = "Écris ton nom pour signer ton message.";
      champNom.setAttribute("aria-invalid", "true");
      premierChampInvalide = champNom;
    }
    if (!texte) {
      erreurMessage.textContent = "Écris quelques mots avant de déposer ton message.";
      champMessage.setAttribute("aria-invalid", "true");
      premierChampInvalide = premierChampInvalide || champMessage;
    }
    if (premierChampInvalide) premierChampInvalide.focus();
    return !premierChampInvalide;
  }

  function reinitialiserFormulaire() {
    formulaire.reset();
    effacerErreurs();
    majCompteur();
  }

  function basculerMode(correction) {
    mode.hidden = !correction;
    boutonAnnuler.hidden = !correction;
    texteEnvoi.textContent = correction ? "Enregistrer la correction" : "Déposer mon message";
    if (!correction) enCorrection = null;
  }

  [champNom, champMessage].forEach((champ) =>
    champ.addEventListener("input", () => {
      champ.removeAttribute("aria-invalid");
      (champ === champNom ? erreurNom : erreurMessage).textContent = "";
      confirmation.textContent = "";
      majCompteur();
    })
  );

  formulaire.addEventListener("submit", async (evenement) => {
    evenement.preventDefault();
    const nom = champNom.value.trim();
    const texte = champMessage.value.trim();
    if (!valider(nom, texte)) return;

    boutonEnvoi.disabled = true;           // évite les doubles envois
    try {
      if (enCorrection) {
        await modifierMessage(enCorrection, { nom, texte });
        nouvelleId = enCorrection;
        basculerMode(false);
        confirmation.textContent = "Ta correction a été enregistrée.";
      } else {
        nouvelleId = await ajouterMessage({ nom, texte });
        confirmation.textContent = "Merci, ton message a été glissé dans le livre.";
      }
      reinitialiserFormulaire();
      await rafraichir();
    } catch (erreur) {
      console.error(erreur);
      confirmation.textContent = "Ton message n’a pas pu être envoyé. Vérifie ta connexion et réessaie.";
    } finally {
      boutonEnvoi.disabled = false;
    }
  });

  /* ---------- CORRIGER ---------- */
  function commencerCorrection(m) {
    enCorrection = m.id;
    champNom.value = m.nom;
    champMessage.value = m.texte;
    effacerErreurs();
    majCompteur();
    confirmation.textContent = "";
    basculerMode(true);
    afficherMessages();                                            // met la carte en surbrillance
    formulaire.scrollIntoView({ behavior: defilement, block: "center" });
    champMessage.focus({ preventScroll: true });
  }

  boutonAnnuler.addEventListener("click", () => {
    basculerMode(false);
    reinitialiserFormulaire();
    confirmation.textContent = "";
    afficherMessages();
  });

  /* ---------- RETIRER (avec confirmation) ---------- */
  function demanderSuppression(m) {
    aSupprimer = m.id;
    dialogue.returnValue = "";
    dialogue.showModal();
  }

  dialogue.addEventListener("close", async () => {
    const id = aSupprimer;
    aSupprimer = null;
    if (dialogue.returnValue !== "retirer" || !id) return;
    try {
      await supprimerMessage(id);
      if (enCorrection === id) { basculerMode(false); reinitialiserFormulaire(); }
      confirmation.textContent = "Le message a été retiré du livre.";
      await rafraichir();
    } catch (erreur) {
      console.error(erreur);
      confirmation.textContent = "Le message n’a pas pu être retiré. Réessaie dans un instant.";
    }
  });

  /* ---------- DÉMARRAGE ---------- */
  async function demarrer() {
    majCompteur();
    try {
      // Connexion anonyme : crée l'identifiant invisible du visiteur (gardé dans son navigateur)
      let { data: { session } } = await db.auth.getSession();
      if (!session) {
        const { data, error } = await db.auth.signInAnonymously();
        if (error) throw error;
        session = data.session;
      }
      MON_ID = session.user.id;
    } catch (erreur) {
      console.error(erreur);
      confirmation.textContent = "La connexion au livre d’or a échoué. Recharge la page.";
    }

    await rafraichir();

    // Mise à jour en direct : un message écrit par quelqu'un d'autre apparaît tout seul
    db.channel("livre-or")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, rafraichir)
      .subscribe();

    // Au retour sur l'onglet, on recharge au cas où
    document.addEventListener("visibilitychange", () => { if (!document.hidden) rafraichir(); });
  }

  demarrer();
})();
