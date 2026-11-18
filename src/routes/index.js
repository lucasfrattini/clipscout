'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const config = require('../config');
const scrapeRoutes = require('./scrape');
const videoRoutes = require('./video');
const profileRoutes = require('./profiles');
const crewRoutes = require('./crew');
const buscarRoutes = require('./buscar');
const sitiosRoutes = require('./sitios');
const sistemaRoutes = require('./sistema');

const router = express.Router();

/** Estado del servicio y límites vigentes (el front los usa para validar). */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    name: 'clipscout',
    uptimeSeconds: Math.floor(process.uptime()),
    limits: {
      maxPages: config.crawl.maxPages,
      maxLinks: config.crawl.maxLinks,
      maxFiles: config.crawl.maxFiles,
      maxConcurrency: config.crawl.maxConcurrency,
      defaultConcurrency: config.crawl.defaultConcurrency,
    },
    browserEnabled: config.browser.enabled,
  });
});

/**
 * Ajustes → Acerca de: la licencia propia y la de los componentes de terceros (SU-09). En el
 * paquete y en Docker TERCEROS.txt está junto a server.js (se genera al compilar); en el
 * repositorio, en empaquetado/.
 */
const RAIZ = path.join(__dirname, '..', '..');
function servirTexto(candidatos) {
  return (req, res) => {
    const ruta = candidatos.map(c => path.join(RAIZ, c)).find(c => fs.existsSync(c));
    if (!ruta) return res.status(404).json({ detail: 'No está en esta instalación.' });
    res.set('Cache-Control', 'no-cache');
    return res.type('text/plain; charset=utf-8').sendFile(ruta);
  };
}
router.get('/licencia', servirTexto(['LICENSE']));
router.get('/terceros', servirTexto(['TERCEROS.txt', path.join('empaquetado', 'TERCEROS.txt')]));

// Antes que las del protocolo: la copia de la suite cuelga de /crew/v1 y vale con sesión.
router.use(sistemaRoutes);
router.use(scrapeRoutes);
router.use(videoRoutes);
router.use(profileRoutes);
router.use(crewRoutes);
router.use(buscarRoutes);
router.use(sitiosRoutes);

module.exports = router;
