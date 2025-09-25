document.addEventListener("DOMContentLoaded", function () {
    const carouselTrack = document.getElementById("carousel-track");
    if (!carouselTrack) return;

    let images = Array.from(carouselTrack.children);
    let imageWidth = 0;
    let trackWidth = 0;
    let positionX = 0;

    const baseSpeed = 1;    // smooth default
    const hoverSpeed = 2.6; // faster on hover
    let currentSpeed = baseSpeed;
    let targetSpeed = baseSpeed;
    let scrollDirection = -1; // left by default
    let animationFrame = null;
    let isHovering = false;

    function computeDimensions() {
        images = Array.from(carouselTrack.children);

        // Measure based on first visible image
        const firstImg = images.find(img => img.naturalWidth || img.complete) || images[0];
        imageWidth = firstImg ? firstImg.getBoundingClientRect().width : 360;

        // Clone until we have ≥ 2x viewport width
        const viewport = carouselTrack.parentElement; // .carousel-viewport
        const minStrip = (viewport?.clientWidth || window.innerWidth) * 2;

        while (carouselTrack.scrollWidth < minStrip && images.length) {
            images.forEach(img => {
                const clone = img.cloneNode(true);
                clone.setAttribute("aria-hidden", "true");
                carouselTrack.appendChild(clone);
            });
        }

        // Half of total scrollable width is one seamless loop
        trackWidth = carouselTrack.scrollWidth / 2;
    }

    function updateScroll() {
        // ease toward the target speed
        currentSpeed += (targetSpeed - currentSpeed) * 0.07;

        positionX += scrollDirection * currentSpeed;

        // seamless loop
        if (positionX <= -trackWidth) {
            positionX += trackWidth;
        } else if (positionX >= 0) {
            positionX -= trackWidth;
        }

        carouselTrack.style.transform = `translate3d(${positionX}px, 0, 0)`;
        animationFrame = requestAnimationFrame(updateScroll);
    }

    function startAutoScroll() {
        if (!animationFrame) animationFrame = requestAnimationFrame(updateScroll);
    }

    function startHoverScroll(direction) {
        if (!isHovering) {
            isHovering = true;
            scrollDirection = direction;
            targetSpeed = hoverSpeed;
        }
    }

    function stopHoverScroll() {
        if (isHovering) {
            isHovering = false;
            targetSpeed = baseSpeed * 0.8; // coast
            setTimeout(() => { targetSpeed = baseSpeed; }, 300);
        }
    }

    // Initialize after images are ready enough to measure
    function initializeCarousel() {
        const allComplete = images.every(img => img.complete);
        if (allComplete) {
            computeDimensions();
            startAutoScroll();
        } else {
            let loaded = 0;
            images.forEach(img => {
                img.addEventListener("load", () => {
                    loaded++;
                    if (loaded === images.length) {
                        computeDimensions();
                        startAutoScroll();
                    }
                }, { once: true });
                img.addEventListener("error", () => {
                    // still proceed; background color keeps block visible
                    loaded++;
                    if (loaded === images.length) {
                        computeDimensions();
                        startAutoScroll();
                    }
                }, { once: true });
            });

            // Safety: if some images are cached & some never fire 'load', start after a small delay
            setTimeout(() => {
                if (!animationFrame) {
                    computeDimensions();
                    startAutoScroll();
                }
            }, 800);
        }
    }

    initializeCarousel();

    // Hover zones
    const leftZone  = document.querySelector(".left-zone");
    const rightZone = document.querySelector(".right-zone");
    if (leftZone && rightZone) {
        leftZone.addEventListener("mouseenter", () => startHoverScroll(1));
        rightZone.addEventListener("mouseenter", () => startHoverScroll(-1));
        leftZone.addEventListener("mouseleave", stopHoverScroll);
        rightZone.addEventListener("mouseleave", stopHoverScroll);
    }

    // Recompute on resize (debounced)
    let resizeTimer = null;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            positionX = 0;
            computeDimensions();
        }, 150);
    });
});
