// Loads the exported model, lookup table and result tables once.
import { Model } from './model.js';

const cache = {};
const url = p => new URL(p, document.baseURI).href;
function json(name) {
  cache[name] ||= fetch(url(`data/${name}.json`)).then(r => {
    if (!r.ok) throw new Error(`Could not load ${name} (${r.status})`);
    return r.json();
  });
  return cache[name];
}
export const loadResults = () => json('results');
export const loadGrid = () => json('grid');
export const loadModel = () => json('model').then(j => new Model(j));
export const loadReduced = () => json('model_reduced').then(j => new Model(j));
export const loadParity = () => Promise.all([json('parity'), json('parity_model')]);
export const demoUrl = () => url('demo_hospital.csv');
